(function initContent(global) {
  const root = global.RAB || (global.RAB = {});
  const C = root.constants;
  const U = root.utils;
  const logger = root.logger;

  // These are reset when UI is disabled/enabled so we can re-mount on the same page.
  let discoveredAnchors = new WeakSet();
  let mountedAnchors = new WeakSet();
  let anchorToUsername = new WeakMap();
  let anchorToRecentActivity = new WeakMap();
  const usernameToAnchors = new Map();
  const usernameTasks = new Map();
  const usernameSnapshots = new Map();
  const usernameErrors = new Map();

  // Toolbar icon badge reporting (MV3 background.js aggregates across tabs).
  let badgePort = null;
  let badgePollTimer = null;
  let lastBadgeCount = null;

  // UI toggle: when false, we hide all injected UI and do no work.
  let uiEnabled = true;
  // Network toggle: when false, we render "Scan" prompts instead of auto-fetching.
  let autoScanEnabled = true;
  // Controls the 😎 marker only.
  let showHiddenIndicator = true;
  let refreshTimer = null;
  let viewportObserver = null;
  let domObserver = null;
  let urlPollTimer = null;
  let eventsUnsub = null;
  let rateLimitUnsub = null;
  let navListenersInstalled = false;

  function isUiEnabled() {
    return uiEnabled;
  }

  function isAutoScanEnabled() {
    // Auto-scan never runs when UI is hidden.
    return uiEnabled && autoScanEnabled;
  }

  function getDefaultScanContext() {
    return {
      hideBadgeUsernames: ['AutoModerator'],
      autoDetectRecentActivity: true
    };
  }

  function computeActiveScanCount() {
    try {
      const stats = root.service && typeof root.service.getStats === 'function' ? root.service.getStats() : null;
      if (stats && typeof stats === 'object') {
        const inFlight = Number(stats.inFlightUsers) || 0;
        const refining = Number(stats.refiningUsers) || 0;
        return Math.max(0, inFlight + refining);
      }
    } catch (_) {
      // ignore
    }
    return usernameTasks.size;
  }

  function ensureBadgePort() {
    if (badgePort) {
      return badgePort;
    }
    try {
      if (global.chrome && global.chrome.runtime && typeof global.chrome.runtime.connect === 'function') {
        badgePort = global.chrome.runtime.connect({ name: 'rab-badge' });
        badgePort.onDisconnect.addListener(() => {
          badgePort = null;
        });
      }
    } catch (_) {
      badgePort = null;
    }
    return badgePort;
  }

  function postBadgeMessage(msg) {
    const port = ensureBadgePort();
    if (port) {
      try {
        port.postMessage(msg);
        return;
      } catch (_) {
        badgePort = null;
      }
    }

    // Fallback if the port isn't available (should be rare).
    try {
      if (global.chrome && global.chrome.runtime && typeof global.chrome.runtime.sendMessage === 'function') {
        global.chrome.runtime.sendMessage(msg, () => {});
      }
    } catch (_) {
      // ignore
    }
  }

  function reportBadgeCountNow() {
    const count = computeActiveScanCount();
    if (count === lastBadgeCount) {
      return count;
    }
    lastBadgeCount = count;
    postBadgeMessage({ type: 'rab-scan-count', count });
    return count;
  }

  function kickBadgeReporter() {
    // Debounce into a single poll loop. While count > 0, keep polling so the badge stays accurate
    // across background refine/backoff and clears reliably when it reaches 0.
    if (badgePollTimer !== null) {
      return;
    }
    const tick = () => {
      badgePollTimer = null;
      const count = reportBadgeCountNow();
      if (count > 0) {
        badgePollTimer = setTimeout(tick, 800);
      }
    };
    tick();
  }

  async function loadRuntimeOptions() {
    try {
      const got = await U.storageGet([C.STORAGE_KEYS.OPTIONS]);
      const opt = got[C.STORAGE_KEYS.OPTIONS] && typeof got[C.STORAGE_KEYS.OPTIONS] === 'object'
        ? got[C.STORAGE_KEYS.OPTIONS]
        : {};
      const hideBadges = opt.hideBadges === true || (typeof opt.hideBadges !== 'boolean' && opt.enabled === false);
      return {
        uiEnabled: !hideBadges,
        autoScanEnabled: !hideBadges && opt.autoScan !== false,
        showHiddenIndicator: opt.showHiddenIndicator !== false
      };
    } catch (_) {
      return {
        uiEnabled: true,
        autoScanEnabled: true,
        showHiddenIndicator: true
      };
    }
  }

  function ensureViewportObserver() {
    if (viewportObserver) {
      return viewportObserver;
    }

    viewportObserver = new IntersectionObserver(onVisibilityChange, {
      root: null,
      rootMargin: C.OBSERVATION.VIEWPORT_ROOT_MARGIN,
      threshold: C.OBSERVATION.VIEWPORT_THRESHOLD
    });

    return viewportObserver;
  }

  function onVisibilityChange(entries) {
    if (!isUiEnabled()) {
      return;
    }
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }

      const anchor = entry.target;
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      const username = anchorToUsername.get(anchor);
      if (!username) {
        return;
      }

      const seenRecentUserActivity = anchorToRecentActivity.get(anchor) === true;
      const nextContext = seenRecentUserActivity ? { seenRecentUserActivity } : null;
      mountForAnchor(anchor, username, { forceScan: false, context: nextContext });
    });
  }


  function isIgnoredUsername(username) {
    const u = String(username || '').toLowerCase();
    return Array.isArray(C.IGNORE && C.IGNORE.USERNAMES) && C.IGNORE.USERNAMES.indexOf(u) >= 0;
  }

  function isInModeratorsWidget(anchor) {
    const selector = C.IGNORE && C.IGNORE.MODERATORS_LINK_SELECTOR ? C.IGNORE.MODERATORS_LINK_SELECTOR : null;
    const maxHops = Number.isFinite(C.IGNORE && C.IGNORE.MODERATORS_MAX_ANCESTOR_HOPS)
      ? C.IGNORE.MODERATORS_MAX_ANCESTOR_HOPS
      : 8;

    if (!(anchor instanceof Element)) {
      return false;
    }

    // Fast-path: the moderators list uses `ul[role="presentation"].p-0.-mt-xs` (observed in the wild).
    try {
      const ul = anchor.closest && anchor.closest('ul[role="presentation"]');
      if (ul && ul.classList && ul.classList.contains('-mt-xs')) {
        return true;
      }
    } catch (_) {
      // ignore
    }

    if (!selector) {
      return false;
    }

    let node = anchor;
    for (let i = 0; i < maxHops; i++) {
      node = node && node.parentElement ? node.parentElement : null;
      if (!node) {
        break;
      }
      try {
        if (node.querySelector && node.querySelector(selector)) {
          return true;
        }
      } catch (_) {
        // ignore
      }
    }

    return false;
  }

  function shouldIgnoreUserAnchor(anchor, username) {
    if (isIgnoredUsername(username)) {
      return true;
    }

    return false;
  }

  function scanAndTrack(scope, opts) {
    if (!isUiEnabled()) {
      return;
    }
    const options = opts && typeof opts === 'object' ? opts : {};
    const context = options.context && typeof options.context === 'object' ? options.context : null;
    const forceMount = Boolean(options.forceMount);
    const forceScan = Boolean(options.forceScan);
    const searchRoot = scope && scope.querySelectorAll ? scope : document;
    const anchors = searchRoot.querySelectorAll(C.SELECTORS.USER_ANCHOR);
    const observer = ensureViewportObserver();

    const hideBadgeUsernames = context && Array.isArray(context.hideBadgeUsernames)
      ? new Set(context.hideBadgeUsernames.map((value) => U.toLowerSafe(U.normalizeUsername(value))))
      : null;

    const shouldMarkRecent = Boolean(context && context.markRecentActivity);
    const shouldAutoDetectRecent = Boolean(context && context.autoDetectRecentActivity);

    anchors.forEach((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (discoveredAnchors.has(anchor)) {
        const username = anchorToUsername.get(anchor);
        if (username) {
          // Re-attach meta links if the UI was toggled off/on.
          try {
            if (root.metaLinks && typeof root.metaLinks.attachMetaLinks === 'function') {
              root.metaLinks.attachMetaLinks(anchor, username);
            }
          } catch (_) {
            // ignore
          }

          if (forceMount) {
            const seenRecentUserActivity = anchorToRecentActivity.get(anchor) === true;
            const nextContext = context && typeof context === 'object'
              ? Object.assign({}, context, { seenRecentUserActivity })
              : (seenRecentUserActivity ? { seenRecentUserActivity } : null);
            mountForAnchor(anchor, username, { forceScan, context: nextContext });
          } else if (observer && !mountedAnchors.has(anchor)) {
            observer.observe(anchor);
          }
        }
        return;
      }

      const username = U.parseUsernameFromHref(anchor.href);
      if (!username || U.toLowerSafe(username) === 'me') {
        return;
      }

      if (!U.isLikelyUsernameAnchor(anchor, username)) {
        return;
      }

      const normalizedUser = U.toLowerSafe(U.normalizeUsername(username));

      if (shouldIgnoreUserAnchor(anchor, normalizedUser)) {
        // Mark as discovered so we don't keep re-scanning ignored anchors.
        discoveredAnchors.add(anchor);
        return;
      }
      discoveredAnchors.add(anchor);
      anchorToUsername.set(anchor, normalizedUser);
      addAnchorForUsername(normalizedUser, anchor);

      if (shouldMarkRecent) {
        anchorToRecentActivity.set(anchor, true);
      }
      if (shouldAutoDetectRecent) {
        try {
          const container = anchor.closest && anchor.closest(C.SELECTORS.COMMENT_CONTAINER_HINT);
          anchorToRecentActivity.set(anchor, Boolean(container));
        } catch (_) {
          // ignore
        }
      }

      // Add quick meta links next to the timestamp line (posts | comments).
      try {
        if (root.metaLinks && typeof root.metaLinks.attachMetaLinks === 'function') {
          root.metaLinks.attachMetaLinks(anchor, normalizedUser);
        }
      } catch (_) {
        // ignore
      }

      if (forceMount) {
        const seenRecentUserActivity = anchorToRecentActivity.get(anchor) === true;
        const nextContext = context && typeof context === 'object'
          ? Object.assign({}, context, { seenRecentUserActivity })
          : (seenRecentUserActivity ? { seenRecentUserActivity } : null);
        if (hideBadgeUsernames && hideBadgeUsernames.has(normalizedUser)) {
          return;
        }
        mountForAnchor(anchor, normalizedUser, { forceScan, context: nextContext });
        return;
      }
      observer.observe(anchor);
    });
  }

  async function mountForAnchor(anchor, username, opts) {
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }

    const normalizedUser = U.toLowerSafe(U.normalizeUsername(username));
    const cachedSnapshot = usernameSnapshots.get(normalizedUser);
    if (cachedSnapshot) {
      mountedAnchors.add(anchor);
      root.renderer.renderBadges(anchor, normalizedUser, cachedSnapshot);
      return;
    }

    const options = opts && typeof opts === 'object' ? opts : {};
    const forceScan = Boolean(options.forceScan);
    const context = options.context && typeof options.context === 'object' ? options.context : null;


    if (mountedAnchors.has(anchor) && !forceScan) {
      return;
    }

    mountedAnchors.add(anchor);
    if (viewportObserver) {
      viewportObserver.unobserve(anchor);
    }

    const manualOnly = isInModeratorsWidget(anchor);
    if (manualOnly) {
      // Right-sidebar moderators pane: never auto-scan here (even for "scan current page").
      // Users can still click the Scan pill to fetch intentionally.
      root.renderer.renderScan(anchor, normalizedUser, { reason: 'moderators-pane' });
      return;
    }

    const allowAutoScan = isAutoScanEnabled();
    if (!forceScan && !allowAutoScan) {
      root.renderer.renderScan(anchor, normalizedUser);
      return;
    }

    root.renderer.renderLoading(anchor, normalizedUser);

    let task = usernameTasks.get(normalizedUser);
    if (!task) {
      task = root.service.buildUserActivitySnapshot(normalizedUser, { context })
        .then((snapshot) => {
          usernameSnapshots.set(normalizedUser, snapshot);
          usernameErrors.delete(normalizedUser);
          trimUsernameSnapshotsIfNeeded();
          renderSnapshotForUsername(normalizedUser, snapshot);
          return snapshot;
        })
        .catch(async (error) => {
          if (error && error.name === 'AbortError') {
            return null;
          }
          usernameErrors.set(normalizedUser, classifyError(error));
          await logger.appendHardFailure({
            type: 'mount-failure',
            username: normalizedUser,
            phase: 'render',
            details: {
              name: error && error.name ? error.name : 'Error',
              message: error && error.message ? error.message : String(error)
            }
          });

          logger.error('failed to mount badges for user', {
            username: normalizedUser,
            error
          });

          renderErrorForUsername(normalizedUser);
          throw error;
        })
        .finally(() => {
          usernameTasks.delete(normalizedUser);
          kickBadgeReporter();
        });

      usernameTasks.set(normalizedUser, task);
      kickBadgeReporter();
    }

    try {
      await task;
    } catch (_) {
      // Already logged and rendered once for this username.
    }
  }

  function addAnchorForUsername(username, anchor) {
    let set = usernameToAnchors.get(username);
    if (!set) {
      set = new Set();
      usernameToAnchors.set(username, set);
    }
    set.add(anchor);
  }

  function getAnchorsForUsername(username) {
    const set = usernameToAnchors.get(username);
    if (!set || set.size === 0) {
      return [];
    }

    const activeAnchors = [];
    set.forEach((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      if (!anchor.isConnected) {
        set.delete(anchor);
        return;
      }
      activeAnchors.push(anchor);
    });

    if (set.size === 0) {
      usernameToAnchors.delete(username);
    }

    return activeAnchors;
  }

  function renderSnapshotForUsername(username, snapshot) {
    const anchors = getAnchorsForUsername(username);
    anchors.forEach((anchor) => {
      if (!mountedAnchors.has(anchor)) {
        return;
      }
      root.renderer.renderBadges(anchor, username, snapshot);
    });
  }

  function renderErrorForUsername(username) {
    const errorInfo = usernameErrors.get(username) || null;
    const anchors = getAnchorsForUsername(username);
    anchors.forEach((anchor) => {
      if (!mountedAnchors.has(anchor)) {
        return;
      }
      root.renderer.renderError(anchor, username, errorInfo);
    });
  }

  function classifyError(error) {
    if (error && error.name === 'AbortError') {
      return {
        status: null,
        isRateLimited: false,
        isAborted: true
      };
    }
    const details = error && error.details && typeof error.details === 'object' ? error.details : {};
    const status = Number(details.status);
    return {
      status: Number.isFinite(status) ? status : null,
      isRateLimited: status === 429
    };
  }

  function trimUsernameSnapshotsIfNeeded() {
    const maxEntries = C.CACHE.MEMORY_MAX_USERS;
    if (usernameSnapshots.size <= maxEntries) {
      return;
    }

    const keys = Array.from(usernameSnapshots.keys());
    const overflow = usernameSnapshots.size - maxEntries;
    for (let i = 0; i < overflow; i += 1) {
      usernameSnapshots.delete(keys[i]);
    }
  }

  function scheduleRefresh(delayMs) {
    if (!isUiEnabled()) {
      return;
    }
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      scanAndTrack(document, { context: getDefaultScanContext() });
    }, delayMs);
  }

  function onNavigationContextChanged() {
    // Reddit is a SPA; cancel in-flight work when the user navigates away to avoid
    // wasting requests and hitting rate limits.
    try {
      if (root.service && typeof root.service.cancelAllInFlight === 'function') {
        root.service.cancelAllInFlight();
      }
    } catch (_) {
      // ignore
    }

    usernameTasks.clear();
    usernameErrors.clear();
  }

  function observeDom() {
    domObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) {
            continue;
          }

          if (node.matches(C.SELECTORS.USER_ANCHOR) || node.querySelector(C.SELECTORS.USER_ANCHOR)) {
            scheduleRefresh(C.OBSERVATION.MUTATION_SCAN_DEBOUNCE_MS);
            return;
          }
        }
      }
    });

    domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function observeRedditNavigation() {
    if (!navListenersInstalled) {
      navListenersInstalled = true;

      document.addEventListener('readystatechange', () => {
        if (document.readyState === 'complete') {
          scheduleRefresh(C.OBSERVATION.READY_STATE_SCAN_DELAY_MS);
        }
      });

      global.addEventListener('popstate', () => {
        onNavigationContextChanged();
        scheduleRefresh(C.OBSERVATION.POPSTATE_SCAN_DELAY_MS);
      });
    }

    let lastUrl = global.location.href;
    urlPollTimer = setInterval(() => {
      if (global.location.href !== lastUrl) {
        lastUrl = global.location.href;
        onNavigationContextChanged();
        scheduleRefresh(C.OBSERVATION.URL_CHANGE_SCAN_DELAY_MS);
      }
    }, C.OBSERVATION.URL_POLL_INTERVAL_MS);
  }

  function start() {
    logger.info('content script started');
    // Expose runtime UI flags for renderer/meta components.
    root.runtimeOptions = {
      showHiddenIndicator
    };
    ensureViewportObserver();
    observeDom();
    observeRedditNavigation();
    scanAndTrack(document, { context: getDefaultScanContext() });

    // Ensure the MV3 background service worker wakes at least once to install alarms.
    try {
      if (global.chrome && global.chrome.runtime && typeof global.chrome.runtime.sendMessage === 'function') {
        global.chrome.runtime.sendMessage({ type: 'rab-ensure-alarm' }, () => {});
      }
    } catch (_) {
      // ignore
    }

    // Initialize toolbar badge state.
    kickBadgeReporter();

    if (root.events && typeof root.events.on === 'function') {
      eventsUnsub = root.events.on('snapshot', (payload) => {
        if (!isUiEnabled()) {
          return;
        }
        const u = payload && payload.username ? String(payload.username) : '';
        const snapshot = payload && payload.snapshot ? payload.snapshot : null;
        if (!u || !snapshot) {
          return;
        }
        usernameSnapshots.set(u, snapshot);
        renderSnapshotForUsername(u, snapshot);
      });

      rateLimitUnsub = root.events.on('rateLimit', (payload) => {
        if (!isUiEnabled()) {
          return;
        }
        // If the global queue is cooling down, avoid leaving "loading…" stuck.
        usernameTasks.forEach((_, u) => {
          if (usernameSnapshots.has(u)) {
            return;
          }
          usernameErrors.set(u, {
            status: 429,
            isRateLimited: true,
            untilMs: payload && payload.untilMs ? payload.untilMs : null
          });
          renderErrorForUsername(u);
        });
      });
    }
  }

  function stop() {
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (viewportObserver) {
      viewportObserver.disconnect();
      viewportObserver = null;
    }
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    if (urlPollTimer !== null) {
      clearInterval(urlPollTimer);
      urlPollTimer = null;
    }
    if (typeof eventsUnsub === 'function') {
      eventsUnsub();
      eventsUnsub = null;
    }
    if (typeof rateLimitUnsub === 'function') {
      rateLimitUnsub();
      rateLimitUnsub = null;
    }

    try {
      if (root.service && typeof root.service.cancelAllInFlight === 'function') {
        root.service.cancelAllInFlight();
      }
    } catch (_) {
      // ignore
    }

    // Hide any mounted UI when disabled.
    try {
      const nodes = document.querySelectorAll(`.${C.UI.ROOT_CLASS}`);
      nodes.forEach((n) => n.remove());
    } catch (_) {
      // ignore
    }

    // Remove quick meta links when disabled.
    try {
      const metaLinks = document.querySelectorAll('.rab-meta-links, .rab-meta-links-sep, .rab-hidden-indicator');
      metaLinks.forEach((n) => n.remove());
    } catch (_) {
      // ignore
    }

    // Reset mount/discovery state so re-enabling on the same page works.
    discoveredAnchors = new WeakSet();
    mountedAnchors = new WeakSet();
    anchorToUsername = new WeakMap();
    anchorToRecentActivity = new WeakMap();
    usernameToAnchors.clear();

    // Clear toolbar badge contribution for this tab.
    try {
      if (badgePollTimer !== null) {
        clearTimeout(badgePollTimer);
        badgePollTimer = null;
      }
    } catch (_) {
      // ignore
    }
    lastBadgeCount = null;
    postBadgeMessage({ type: 'rab-scan-count', count: 0 });
  }

  function installRetryHandler() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const btn = target.closest && target.closest('button[data-rab-retry-user]');
      if (!btn) {
        return;
      }

      const u = btn.getAttribute('data-rab-retry-user');
      const username = u ? U.toLowerSafe(String(u)) : '';
      if (!username) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      forceRetryUsername(username);
    }, true);
  }

  async function forceRetryUsername(username) {
    if (!isUiEnabled()) {
      return;
    }

    const u = U.toLowerSafe(U.normalizeUsername(username));
    if (!u) {
      return;
    }

    if (usernameTasks.has(u)) {
      try {
        if (root.service && typeof root.service.cancelUser === 'function') {
          root.service.cancelUser(u);
        }
      } catch (_) {
        // ignore
      }
      usernameTasks.delete(u);
    }

    usernameSnapshots.delete(u);
    usernameErrors.delete(u);

    try {
      if (root.service && typeof root.service.invalidateUser === 'function') {
        await root.service.invalidateUser(u);
      }
    } catch (_) {
      // ignore
    }

    const anchors = getAnchorsForUsername(u);
    anchors.forEach((anchor) => {
      if (mountedAnchors.has(anchor)) {
        root.renderer.renderLoading(anchor, u);
      }
    });

    let task = root.service.buildUserActivitySnapshot(u)
      .then((snapshot) => {
        usernameSnapshots.set(u, snapshot);
        usernameErrors.delete(u);
        trimUsernameSnapshotsIfNeeded();
        renderSnapshotForUsername(u, snapshot);
        return snapshot;
      })
      .catch((error) => {
        if (error && error.name === 'AbortError') {
          return null;
        }
        usernameErrors.set(u, classifyError(error));
        renderErrorForUsername(u);
        throw error;
      })
      .finally(() => {
        usernameTasks.delete(u);
        kickBadgeReporter();
      });

    usernameTasks.set(u, task);
    kickBadgeReporter();
    try {
      await task;
    } catch (_) {
      // already handled
    }
  }

  function listenForMessages() {
    if (!global.chrome || !global.chrome.runtime || !global.chrome.runtime.onMessage) {
      return;
    }
    global.chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') {
        return;
      }
      if (msg.type === 'rab-run-page') {
        scanAndTrack(document, {
          forceMount: true,
          forceScan: true,
          context: getDefaultScanContext()
        });
        if (typeof sendResponse === 'function') {
          sendResponse({ ok: true });
        }
        return;
      }
      if (msg.type === 'rab-get-stats') {
        const serviceStats = root.service && typeof root.service.getStats === 'function'
          ? root.service.getStats()
          : null;
        if (typeof sendResponse === 'function') {
          sendResponse({
            uiEnabled,
            autoScanEnabled: isAutoScanEnabled(),
            inFlightUsers: usernameTasks.size,
            service: serviceStats
          });
        }
        return;
      }
      if (msg.type === 'rab-cancel-inflight') {
        cancelAllInFlight('popup');
        if (typeof sendResponse === 'function') {
          sendResponse({ ok: true });
        }
        return;
      }
    });
  }

  function listenForOptionChanges() {
    if (!global.chrome || !global.chrome.storage || !global.chrome.storage.onChanged) {
      return;
    }

    global.chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') {
        return;
      }
      if (!changes || !Object.prototype.hasOwnProperty.call(changes, C.STORAGE_KEYS.OPTIONS)) {
        return;
      }

      const next = changes[C.STORAGE_KEYS.OPTIONS] && changes[C.STORAGE_KEYS.OPTIONS].newValue
        ? changes[C.STORAGE_KEYS.OPTIONS].newValue
        : {};
      const hideBadges = next.hideBadges === true || (typeof next.hideBadges !== 'boolean' && next.enabled === false);
      const nextUiEnabled = !hideBadges;
      const nextAutoScanEnabled = !hideBadges && next.autoScan !== false;
      const nextShowHidden = next.showHiddenIndicator !== false;

      const prevUiEnabled = uiEnabled;
      const prevAutoScan = autoScanEnabled;
      const prevShowHidden = showHiddenIndicator;

      uiEnabled = nextUiEnabled;
      autoScanEnabled = nextAutoScanEnabled;
      showHiddenIndicator = nextShowHidden;
      root.runtimeOptions = { showHiddenIndicator };

      if (prevUiEnabled !== uiEnabled) {
        if (uiEnabled) {
          start();
        } else {
          stop();
        }
        return;
      }

      if (prevAutoScan !== autoScanEnabled) {
        if (!autoScanEnabled) {
          cancelAllInFlight('auto-scan-off');
        } else {
          // Auto-scan turned on: scan any existing "Scan" prompts.
          triggerAutoScanForScanPrompts();
        }
      }

      if (prevShowHidden !== showHiddenIndicator) {
        if (!showHiddenIndicator) {
          try {
            const nodes = document.querySelectorAll('.rab-hidden-indicator');
            nodes.forEach((n) => n.remove());
          } catch (_) {
            // ignore
          }
        } else {
          // Re-render cached snapshots so indicators can appear again.
          usernameSnapshots.forEach((snapshot, u) => {
            renderSnapshotForUsername(u, snapshot);
          });
        }
      }
    });
  }

  async function init() {
    listenForMessages();
    listenForOptionChanges();
    installRetryHandler();
    installScanHandler();

    const opt = await loadRuntimeOptions();
    uiEnabled = Boolean(opt.uiEnabled);
    autoScanEnabled = Boolean(opt.autoScanEnabled);
    showHiddenIndicator = opt.showHiddenIndicator !== false;
    root.runtimeOptions = { showHiddenIndicator };

    if (!uiEnabled) {
      logger.info('badges hidden by option');
      // Ensure the global badge clears when UI is disabled.
      lastBadgeCount = null;
      postBadgeMessage({ type: 'rab-scan-count', count: 0 });
      return;
    }
    start();
  }

  init();

  // Best-effort: when navigating away / closing the tab, clear our contribution to the global badge.
  // (Background also clears on port disconnect; this helps when the port isn't available.)
  try {
    global.addEventListener('pagehide', () => {
      postBadgeMessage({ type: 'rab-scan-count', count: 0 });
    });
  } catch (_) {
    // ignore
  }

  function triggerAutoScanForScanPrompts() {
    if (!isUiEnabled() || !isAutoScanEnabled()) {
      return;
    }
    const buttons = Array.from(document.querySelectorAll('button[data-rab-scan-user]'));
    const users = new Set();
    buttons.forEach((btn) => {
      const u = btn.getAttribute('data-rab-scan-user');
      if (u) {
        users.add(U.toLowerSafe(String(u)));
      }
    });
    users.forEach((u) => {
      forceRetryUsername(u).catch(() => {});
    });
  }

  function cancelAllInFlight(reason) {
    if (!isUiEnabled()) {
      return;
    }

    try {
      if (root.service && typeof root.service.cancelAllInFlight === 'function') {
        root.service.cancelAllInFlight();
      }
    } catch (_) {
      // ignore
    }

    const users = Array.from(usernameTasks.keys());
    usernameTasks.clear();
    kickBadgeReporter();

    // Replace any stuck "loading…" with a Scan prompt.
    users.forEach((u) => {
      usernameErrors.delete(u);
      const anchors = getAnchorsForUsername(u);
      anchors.forEach((anchor) => {
        if (mountedAnchors.has(anchor) && !usernameSnapshots.has(u)) {
          root.renderer.renderScan(anchor, u, { reason });
        }
      });
    });
  }

  function installScanHandler() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const btn = target.closest && target.closest('button[data-rab-scan-user]');
      if (!btn) {
        return;
      }

      const u = btn.getAttribute('data-rab-scan-user');
      const username = u ? U.toLowerSafe(String(u)) : '';
      if (!username) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      forceRetryUsername(username).catch(() => {});
    }, true);
  }
})(globalThis);

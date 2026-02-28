(function initService(global) {
  const root = global.RAB || (global.RAB = {});
  const C = root.constants;
  const logger = root.logger;
  const U = root.utils;

  const inFlightByUser = new Map();
  const refineInFlightByUser = new Map();
  const abortByUser = new Map();
  const refineAbortByUser = new Map();
  const transientByUser = new Map();
  const userStartsWindow = [];

  async function waitForUserStartBudget() {
    const limit = C.RATE_LIMIT.USER_STARTS_PER_MINUTE;
    if (!Number.isFinite(limit) || limit <= 0) {
      return;
    }

    while (true) {
      const now = U.nowMs();
      // Trim starts older than 60s.
      while (userStartsWindow.length > 0 && (now - userStartsWindow[0]) >= 60000) {
        userStartsWindow.shift();
      }

      if (userStartsWindow.length < limit) {
        userStartsWindow.push(now);
        return;
      }

      const oldest = userStartsWindow[0];
      const waitMs = Math.max(50, 60000 - (now - oldest));
      await U.sleep(waitMs);
    }
  }

  function getTransientSnapshot(username) {
    const entry = transientByUser.get(username);
    if (!entry) {
      return null;
    }

    if (!Number.isFinite(entry.expiresAtMs) || entry.expiresAtMs <= U.nowMs()) {
      transientByUser.delete(username);
      return null;
    }

    return entry.snapshot || null;
  }

  function setTransientSnapshot(username, snapshot) {
    transientByUser.set(username, {
      snapshot,
      expiresAtMs: U.nowMs() + C.CACHE.TRANSIENT_EMPTY_TTL_MS
    });
  }

  function shouldPersistSnapshot(snapshot) {
    const topSubreddits = snapshot && Array.isArray(snapshot.topSubreddits)
      ? snapshot.topSubreddits
      : [];
    const refining = Boolean(snapshot && snapshot.flags && snapshot.flags.refining);
    return topSubreddits.length > 0 && !refining;
  }

  function tagSnapshot(snapshot, fields) {
    const next = Object.assign({}, snapshot);
    next.flags = Object.assign({}, snapshot && snapshot.flags ? snapshot.flags : {}, fields || {});
    return next;
  }

  function shouldRefineOverviewSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.topSubreddits)) {
      return false;
    }
    if (snapshot.topSubreddits.length === 0) {
      return false;
    }
    return snapshot.topSubreddits.length <= C.REFINE.SUSPECT_TOP_SUBREDDITS_MAX;
  }

  function shouldForcePostsOnly(overviewSnapshot) {
    if (!overviewSnapshot || !overviewSnapshot.stats) {
      return false;
    }
    if (overviewSnapshot.stats.itemsProcessed === 0) {
      return true;
    }
    if (Array.isArray(overviewSnapshot.topSubreddits) && overviewSnapshot.topSubreddits.length === 0) {
      return true;
    }
    return false;
  }

  function mergeRankedSubreddits(preferredList, secondaryList) {
    const mergedByKey = new Map();

    function ingest(list, preferName) {
      const items = Array.isArray(list) ? list : [];
      items.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }

        const rawName = String(entry.subreddit || '').trim();
        if (!rawName) {
          return;
        }

        const key = rawName.toLowerCase();
        const existing = mergedByKey.get(key) || {
          subreddit: rawName,
          comments: 0,
          posts: 0
        };

        if (preferName) {
          existing.subreddit = rawName;
        }

        const comments = Number(entry.comments);
        const posts = Number(entry.posts);
        if (Number.isFinite(comments)) {
          existing.comments = Math.max(existing.comments, Math.max(0, Math.floor(comments)));
        }
        if (Number.isFinite(posts)) {
          existing.posts = Math.max(existing.posts, Math.max(0, Math.floor(posts)));
        }

        mergedByKey.set(key, existing);
      });
    }

    // A1 (overview) first so we preserve its subreddit name casing/format.
    ingest(preferredList, true);
    ingest(secondaryList, false);

    return Array.from(mergedByKey.values())
      .map((row) => {
        const comments = Math.max(0, Math.floor(Number(row.comments) || 0));
        const posts = Math.max(0, Math.floor(Number(row.posts) || 0));
        const totalRaw = comments + posts;
        const score = comments + (C.SCORING.POST_WEIGHT * posts);
        return {
          subreddit: row.subreddit,
          comments,
          posts,
          totalRaw,
          score
        };
      })
      .sort((a, b) => b.score - a.score || b.totalRaw - a.totalRaw || a.subreddit.localeCompare(b.subreddit));
  }

  function pickSearchMetaFlags(snapshot) {
    const out = {};
    const flags = snapshot && snapshot.flags && typeof snapshot.flags === 'object' ? snapshot.flags : null;
    if (!flags) {
      return out;
    }

    Object.keys(flags).forEach((key) => {
      if (key && String(key).startsWith('search')) {
        out[key] = flags[key];
      }
    });

    return out;
  }

  function mergeOverviewWithSearchSnapshot(overviewSnapshot, searchSnapshot) {
    if (!overviewSnapshot) {
      return searchSnapshot;
    }

    const overviewRanked = Array.isArray(overviewSnapshot.rankedSubreddits)
      ? overviewSnapshot.rankedSubreddits
      : (Array.isArray(overviewSnapshot.topSubreddits) ? overviewSnapshot.topSubreddits : []);

    const searchRanked = searchSnapshot && Array.isArray(searchSnapshot.rankedSubreddits)
      ? searchSnapshot.rankedSubreddits
      : (searchSnapshot && Array.isArray(searchSnapshot.topSubreddits) ? searchSnapshot.topSubreddits : []);

    const mergedRankedAll = mergeRankedSubreddits(overviewRanked, searchRanked);
    const preferredKeys = new Set(
      (Array.isArray(overviewRanked) ? overviewRanked : [])
        .map((entry) => String(entry && entry.subreddit ? entry.subreddit : '').trim().toLowerCase())
        .filter(Boolean)
    );
    const maxRanked = C.DATA_WINDOW.TOP_BADGES_MAX;
    let rankedAll = mergedRankedAll;
    if (mergedRankedAll.length > maxRanked && preferredKeys.size > 0) {
      const preferred = mergedRankedAll.filter((entry) => preferredKeys.has(String(entry.subreddit || '').toLowerCase()));
      const secondary = mergedRankedAll.filter((entry) => !preferredKeys.has(String(entry.subreddit || '').toLowerCase()));
      const remaining = Math.max(0, maxRanked - preferred.length);
      rankedAll = preferred.concat(secondary.slice(0, remaining));
      rankedAll.sort((a, b) => b.score - a.score || b.totalRaw - a.totalRaw || a.subreddit.localeCompare(b.subreddit));
    } else if (mergedRankedAll.length > maxRanked) {
      rankedAll = mergedRankedAll.slice(0, maxRanked);
    }

    const ranked = rankedAll;
    const top = rankedAll.slice(0, C.DATA_WINDOW.TOP_BADGES);

    const mergedFlags = Object.assign(
      {},
      overviewSnapshot.flags || {},
      pickSearchMetaFlags(searchSnapshot),
      {
        source: 'merged',
        mergedFromSearch: Boolean(searchSnapshot && searchSnapshot.stats && searchSnapshot.stats.itemsProcessed > 0)
      }
    );

    const merged = Object.assign({}, overviewSnapshot, {
      generatedAtMs: U.nowMs(),
      topSubreddits: top,
      rankedSubreddits: ranked,
      flags: mergedFlags
    });

    return merged;
  }

  function isSnapshotDifferentEnough(a, b) {
    if (!a || !b) {
      return true;
    }
    const aItems = Array.isArray(a.topSubreddits) ? a.topSubreddits : [];
    const bItems = Array.isArray(b.topSubreddits) ? b.topSubreddits : [];
    if (aItems.length === 0 && bItems.length === 0) {
      return false;
    }
    if (aItems.length === 0 || bItems.length === 0) {
      return true;
    }
    if (aItems.length !== bItems.length) {
      return true;
    }
    // Compare just the top subreddit name as a cheap signal.
    const aTop = String(aItems[0].subreddit || '').toLowerCase();
    const bTop = String(bItems[0].subreddit || '').toLowerCase();
    return aTop !== bTop;
  }

  async function startBackgroundRefine(username, overviewSnapshot) {
    if (refineInFlightByUser.has(username)) {
      return refineInFlightByUser.get(username);
    }

    const promise = (async () => {
      const controller = new AbortController();
      refineAbortByUser.set(username, controller);
      await U.sleep(C.REFINE.BACKGROUND_START_DELAY_MS);
      const searchSnapshot = await buildSnapshotFromSearch(username, { signal: controller.signal });
      const merged = mergeOverviewWithSearchSnapshot(overviewSnapshot, searchSnapshot);
      const refined = tagSnapshot(merged, { refining: false });

      if (refined.flags && refined.flags.source === 'search' && refined.stats.itemsProcessed > 0) {
        await root.cache.setSourceHint(username, 'search');
      }

      if (shouldPersistSnapshot(refined)) {
        await root.cache.set(username, refined);
        // If we previously served a transient "refining…" snapshot, clear it so subsequent reads hit cache.
        transientByUser.delete(username);
      } else {
        setTransientSnapshot(username, refined);
      }

      // Always emit once refining completes so the UI can clear the "scanning…" chip,
      // even if the refined results are identical to the initial overview snapshot.
      if (root.events && typeof root.events.emit === 'function') {
        root.events.emit('snapshot', { username, snapshot: refined });
      }

      return refined;
    })()
      .catch(async (error) => {
        await logger.appendHardFailure({
          type: 'background-refine-failure',
          username,
          phase: 'refine',
          details: serializeError(error)
        });

        // Clear the "scanning…" chip if we previously returned a refining snapshot.
        try {
          const cleared = tagSnapshot(overviewSnapshot, { refining: false, refineFailed: true });
          setTransientSnapshot(username, cleared);
          if (root.events && typeof root.events.emit === 'function') {
            root.events.emit('snapshot', { username, snapshot: cleared });
          }
        } catch (_) {
          // ignore
        }

        return null;
      })
      .finally(() => {
        refineInFlightByUser.delete(username);
        refineAbortByUser.delete(username);
      });

    refineInFlightByUser.set(username, promise);
    return promise;
  }

  async function buildUserActivitySnapshot(username, opts) {
    const normalizedUser = U.toLowerSafe(U.normalizeUsername(username));
    if (!normalizedUser) {
      throw new Error('invalid username');
    }

    const options = opts && typeof opts === 'object' ? opts : {};
    const context = options.context && typeof options.context === 'object' ? options.context : null;

    if (inFlightByUser.has(normalizedUser)) {
      return inFlightByUser.get(normalizedUser);
    }

    const transient = getTransientSnapshot(normalizedUser);
    if (transient) {
      logger.statusOncePerUser(normalizedUser, 'transient hit');
      return transient;
    }

    const cached = await root.cache.get(normalizedUser);
    if (cached) {
      logger.statusOncePerUser(normalizedUser, 'cache hit');
      return cached;
    }

    const promise = (async () => {
      const controller = new AbortController();
      abortByUser.set(normalizedUser, controller);
      await waitForUserStartBudget();
      const startedAtMs = U.nowMs();
      logger.timing(`user start u=${normalizedUser}`);

      const sourceHint = await root.cache.getSourceHint(normalizedUser);
      const snapshot = await fetchAndAssemble(normalizedUser, sourceHint, { signal: controller.signal, context });

      try {
        if (snapshot && snapshot.flags && snapshot.flags.activityViewId && snapshot.posts) {
          const key = C.STORAGE_KEYS && C.STORAGE_KEYS.ACTIVITY_BASE
            ? `${C.STORAGE_KEYS.ACTIVITY_BASE}${snapshot.flags.activityViewId}`
            : `rab:activity:view:v1:${snapshot.flags.activityViewId}`;
          const payload = {
            username: snapshot.username,
            generatedAtMs: snapshot.generatedAtMs,
            postCount: snapshot.stats ? snapshot.stats.postItemsCount : 0,
            uniqueSubreddits: Array.isArray(snapshot.topSubreddits) ? snapshot.topSubreddits.length : 0,
            topSubreddits: snapshot.topSubreddits || [],
            posts: Array.isArray(snapshot.posts) ? snapshot.posts : []
          };
          await U.storageSet({ [key]: payload });
        }
      } catch (_) {
        // ignore write failures
      }

      if (snapshot.flags && snapshot.flags.source === 'search' && snapshot.stats.itemsProcessed > 0) {
        await root.cache.setSourceHint(normalizedUser, 'search');
      }

      if (shouldPersistSnapshot(snapshot)) {
        await root.cache.set(normalizedUser, snapshot);
      } else {
        setTransientSnapshot(normalizedUser, snapshot);
      }

      logger.timing(
        `user done u=${normalizedUser} src=${snapshot.flags && snapshot.flags.source ? snapshot.flags.source : 'n/a'} dur=${U.nowMs() - startedAtMs}ms in30=${snapshot.stats.inWindowItemsCount}`
      );
      return snapshot;
    })()
      .finally(() => {
        inFlightByUser.delete(normalizedUser);
        abortByUser.delete(normalizedUser);
      });

    inFlightByUser.set(normalizedUser, promise);
    return promise;
  }

  async function invalidateUser(username) {
    const u = U.toLowerSafe(U.normalizeUsername(username));
    if (!u) {
      return;
    }
    transientByUser.delete(u);
    // Don't try to cancel in-flight work; just make sure the next run isn't satisfied by old cache.
    await root.cache.remove(u);
    await root.cache.removeSourceHint(u);
  }

  async function fetchAndAssemble(username, sourceHint, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const signal = options.signal || null;
    const context = options.context && typeof options.context === 'object' ? options.context : null;
    const seenRecentUserActivity = Boolean(context && context.seenRecentUserActivity);
    logger.statusOncePerUser(username, 'loading activity');

    try {
      const overviewSnapshot = await buildSnapshotFromOverview(username, { signal });
      const hasListingData = overviewSnapshot.stats.itemsProcessed > 0;

      if (hasListingData) {
        // If overview contains items but yields no in-window subreddits, it can be:
        // - a truly inactive user, or
        // - a gated/limited listing (blocked/hidden/facade).
        // Running A2 is cheap enough and avoids false "no activity" negatives.
        if (overviewSnapshot.topSubreddits.length === 0) {
          const searchSnapshot = await buildSnapshotFromSearch(username, { signal, postsOnly: true });
          const hasSearchItems = searchSnapshot.stats.itemsProcessed > 0;
          const markHidden = hasSearchItems || seenRecentUserActivity;
          const finalSnapshot = markHidden
            ? tagSnapshot(searchSnapshot, { hiddenProfile: true })
            : tagSnapshot(searchSnapshot, { historyUnavailable: true });
          logSnapshotStatus(username, finalSnapshot);
          return finalSnapshot;
        }

        // If it looks facade/partial, show A1 now and refine in background with A2.
        if (shouldRefineOverviewSnapshot(overviewSnapshot)) {
          const refiningSnapshot = tagSnapshot(overviewSnapshot, {
            refining: true,
            refinePlanned: true
          });
          logSnapshotStatus(username, refiningSnapshot);
          startBackgroundRefine(username, overviewSnapshot);
          return refiningSnapshot;
        }

        logSnapshotStatus(username, overviewSnapshot);
        return overviewSnapshot;
      }

      // If A1 is empty, go straight to A2 (blocking) so we can show something real.
      const searchSnapshot = await buildSnapshotFromSearch(username, { signal, postsOnly: true });
      const markHidden = searchSnapshot.stats.itemsProcessed > 0 || seenRecentUserActivity;
      const finalSnapshot = markHidden
        ? tagSnapshot(searchSnapshot, { hiddenProfile: true })
        : tagSnapshot(searchSnapshot, { historyUnavailable: true });

      logSnapshotStatus(username, finalSnapshot);
      return finalSnapshot;
    } catch (error) {
      await logger.appendHardFailure({
        type: 'snapshot-fetch-failure',
        username,
        phase: 'fetch-and-aggregate',
        details: serializeError(error)
      });

      logger.error('snapshot generation failed', {
        username,
        error
      });

      throw error;
    }
  }

  async function buildSnapshotFromOverview(username, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const signal = options.signal || null;
    const state = root.aggregation.createAggregationState();
    let after = null;
    let previousTopSubreddits = null;
    let lastConfidence = {
      score: 0,
      timeCoverage: 0,
      volume: 0,
      stability: 0,
      topSubreddits: []
    };

    const firstPage = await root.fetcher.fetchPageWithRetry(username, null, null, { signal });
    state.pagesFetched += 1;
    root.aggregation.processPage(state, firstPage.children || []);
    lastConfidence = root.aggregation.computeConfidence(state, previousTopSubreddits);
    previousTopSubreddits = lastConfidence.topSubreddits;
    after = firstPage.after;

    while (true) {
      const hasAfter = Boolean(after);
      if (root.aggregation.shouldStopPaging(state, lastConfidence, hasAfter)) {
        break;
      }

      const page = await root.fetcher.fetchPageWithRetry(username, after, null, { signal });
      state.pagesFetched += 1;
      root.aggregation.processPage(state, page.children || []);
      lastConfidence = root.aggregation.computeConfidence(state, previousTopSubreddits);
      previousTopSubreddits = lastConfidence.topSubreddits;
      after = page.after;
    }

    return tagSnapshot(
      root.aggregation.finalizeResult(username, state, lastConfidence),
      { source: 'overview' }
    );
  }

  async function buildSnapshotFromSearch(username, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const signal = options.signal || null;
    const postsOnly = Boolean(options.postsOnly);
    const searchResult = await root.searchSource.fetchRecentItemsForUser(username, { signal, postsOnly });
    const state = root.aggregation.createAggregationState();
    state.pagesFetched = searchResult.pagesFetched;
    root.aggregation.processPage(state, searchResult.items || []);

    const confidence = root.aggregation.computeConfidence(state, null);
    const baseSnapshot = root.aggregation.finalizeResult(username, state, confidence);
    const posts = Array.isArray(searchResult.items)
      ? searchResult.items
          .filter((item) => item && item.kind === 't3' && item.data)
          .map((item) => ({
            subreddit: item.data.subreddit || '',
            permalink: item.data.permalink || null,
            title: item.data.title || null,
            createdUtcSec: item.data.created_utc || null
          }))
      : [];

    const viewId = U.safeIdFromUrl(`/user/${username}/${U.nowMs()}/${Math.random()}`) || `${username}-${U.nowMs()}`;

    return tagSnapshot(
      Object.assign({}, baseSnapshot, {
        posts
      }),
      {
        source: 'search',
        searchPostsOnly: postsOnly,
        activityViewId: postsOnly ? viewId : '',
        searchCommentsSeen: searchResult.counts ? searchResult.counts.comments : 0,
        searchPostsSeen: searchResult.counts ? searchResult.counts.posts : 0,
        searchCommentPages: searchResult.pagesByType ? searchResult.pagesByType.comments : 0,
        searchPostPages: searchResult.pagesByType ? searchResult.pagesByType.posts : 0
      }
    );
  }

  function cancelUser(username) {
    const u = U.toLowerSafe(U.normalizeUsername(username));
    if (!u) {
      return;
    }

    const controller = abortByUser.get(u);
    if (controller) {
      try {
        controller.abort();
      } catch (_) {
        // ignore
      }
    }

    const refineController = refineAbortByUser.get(u);
    if (refineController) {
      try {
        refineController.abort();
      } catch (_) {
        // ignore
      }
    }

    // Allow immediate retry to start a new promise instead of reusing a soon-to-abort one.
    inFlightByUser.delete(u);
    refineInFlightByUser.delete(u);
    abortByUser.delete(u);
    refineAbortByUser.delete(u);
  }

  function cancelAllInFlight() {
    const users = new Set();
    abortByUser.forEach((_, u) => users.add(u));
    refineAbortByUser.forEach((_, u) => users.add(u));
    users.forEach((u) => cancelUser(u));
  }

  function getStats() {
    return {
      inFlightUsers: inFlightByUser.size,
      refiningUsers: refineInFlightByUser.size,
      abortControllers: abortByUser.size,
      refineAbortControllers: refineAbortByUser.size,
      transientUsers: transientByUser.size
    };
  }

  function logSnapshotStatus(username, snapshot) {
    if (!snapshot) {
      return;
    }

    if (snapshot.topSubreddits.length === 0) {
      const historyUnavailable = Boolean(snapshot.flags && snapshot.flags.historyUnavailable);
      const emptyKind = historyUnavailable
        ? 'history-unavailable'
        : 'no-window-activity';
      const source = snapshot.flags && snapshot.flags.source ? snapshot.flags.source : 'n/a';
      const searchBits = (source === 'search' || source === 'merged')
        ? ` s(c=${snapshot.flags.searchCommentsSeen || 0},p=${snapshot.flags.searchPostsSeen || 0},pc=${snapshot.flags.searchCommentPages || 0},pp=${snapshot.flags.searchPostPages || 0})`
        : '';
      logger.statusOncePerUser(
        username,
        `empty(${emptyKind}) src=${source}${searchBits} p${snapshot.stats.pagesFetched} seen=${snapshot.stats.itemsProcessed} in30=${snapshot.stats.inWindowItemsCount} r=${snapshot.confidence.score.toFixed(2)}`
      );
      return;
    }

    const source = snapshot.flags && snapshot.flags.source ? snapshot.flags.source : 'n/a';
    const searchBits = (source === 'search' || source === 'merged')
      ? ` s(c=${snapshot.flags.searchCommentsSeen || 0},p=${snapshot.flags.searchPostsSeen || 0},pc=${snapshot.flags.searchCommentPages || 0},pp=${snapshot.flags.searchPostPages || 0})`
      : '';
    logger.statusOncePerUser(
      username,
      `ok src=${source}${searchBits} p${snapshot.stats.pagesFetched} in30=${snapshot.stats.inWindowItemsCount} r=${snapshot.confidence.score.toFixed(2)}`
    );
  }

  function serializeError(error) {
    if (!error) {
      return { message: 'unknown error' };
    }

    return {
      name: error.name || 'Error',
      message: error.message || String(error),
      details: error.details || null,
      stack: error.stack || null
    };
  }

  root.service = {
    buildUserActivitySnapshot,
    invalidateUser,
    cancelUser,
    cancelAllInFlight,
    getStats
  };
})(globalThis);

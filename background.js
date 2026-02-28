(function initBackground() {
  const MAX_BADGE_COUNT = 99;
  const BADGE_BG = '#3a4fcf';
  const DEFAULT_TITLE = 'Subreddit Activity Lens';

  // tabId -> count
  const tabCounts = new Map();

  function normalizeCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      return 0;
    }
    return Math.floor(n);
  }

  function formatCount(total) {
    if (total <= 0) {
      return '';
    }
    if (total > MAX_BADGE_COUNT) {
      return `${MAX_BADGE_COUNT}+`;
    }
    return String(total);
  }

  function sumCounts() {
    let total = 0;
    tabCounts.forEach((count) => {
      total += normalizeCount(count);
    });
    return total;
  }

  function updateBadge() {
    const total = sumCounts();
    try {
      chrome.action.setBadgeBackgroundColor({ color: BADGE_BG });
      chrome.action.setBadgeText({ text: formatCount(total) });
      chrome.action.setTitle({ title: total > 0 ? `${DEFAULT_TITLE} (${total} scanning)` : DEFAULT_TITLE });
    } catch (_) {
      // ignore
    }
  }

  function setTabCount(tabId, count) {
    if (typeof tabId !== 'number') {
      return;
    }
    const next = normalizeCount(count);
    if (next <= 0) {
      tabCounts.delete(tabId);
    } else {
      tabCounts.set(tabId, next);
    }
    updateBadge();
  }

  // Clear any stale badge when the worker starts.
  updateBadge();

  chrome.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== 'rab-badge') {
      return;
    }

    const tabId = port.sender && port.sender.tab && typeof port.sender.tab.id === 'number'
      ? port.sender.tab.id
      : null;

    if (typeof tabId !== 'number') {
      return;
    }

    port.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== 'object') {
        return;
      }
      if (msg.type === 'rab-scan-count') {
        setTabCount(tabId, msg.count);
      }
    });

    port.onDisconnect.addListener(() => {
      tabCounts.delete(tabId);
      updateBadge();
    });
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') {
      return;
    }

    if (msg.type === 'rab-ensure-alarm') {
      // Back-compat / no-op: older content scripts ping this to ensure a SW exists.
      if (typeof sendResponse === 'function') {
        sendResponse({ ok: true });
      }
      return;
    }

    if (msg.type === 'rab-scan-count') {
      const tabId = sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : null;
      if (typeof tabId === 'number') {
        setTabCount(tabId, msg.count);
      }
      if (typeof sendResponse === 'function') {
        sendResponse({ ok: true });
      }
    }
  });
})();


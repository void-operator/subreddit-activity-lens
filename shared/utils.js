(function initUtils(global) {
  const root = global.RAB || (global.RAB = {});
  const C = root.constants;

  function nowMs() {
    return Date.now();
  }

  function toLowerSafe(value) {
    return String(value || '').toLowerCase();
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function decodeUsername(raw) {
    try {
      return decodeURIComponent(raw);
    } catch (_) {
      return raw;
    }
  }

  function normalizeUsername(value) {
    return decodeUsername(String(value || '').trim()).replace(/^u\//i, '').replace(/^\/u\//i, '');
  }

  function parseUsernameFromHref(href) {
    if (!href) {
      return null;
    }

    try {
      const url = new URL(href, global.location.origin);
      const match = url.pathname.match(/^\/user\/([^/?#]+)\/?/i);
      if (!match) {
        return null;
      }
      return normalizeUsername(match[1]);
    } catch (_) {
      return null;
    }
  }

  function isLikelyUsernameAnchor(anchor, username) {
    if (!anchor) {
      return false;
    }

    const label = normalizeUsername((anchor.textContent || '').trim());
    if (!label) {
      return false;
    }

    return toLowerSafe(label) === toLowerSafe(username);
  }

  function truncateText(text, maxLength) {
    const value = String(text || '');
    if (value.length <= maxLength) {
      return value;
    }
    return value.slice(0, Math.max(0, maxLength - 1)) + '…';
  }

  function listTopKeysByValue(counterMap, topN) {
    return Array.from(counterMap.entries())
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .slice(0, topN)
      .map((entry) => entry[0]);
  }

  function jaccardIndex(listA, listB) {
    const setA = new Set(listA || []);
    const setB = new Set(listB || []);

    if (setA.size === 0 && setB.size === 0) {
      return 1;
    }

    let intersectionCount = 0;
    for (const item of setA) {
      if (setB.has(item)) {
        intersectionCount += 1;
      }
    }

    const unionCount = setA.size + setB.size - intersectionCount;
    if (unionCount === 0) {
      return 1;
    }

    return intersectionCount / unionCount;
  }

  function buildListingUrl(pathTemplate, username, after) {
    const template = pathTemplate || C.FETCH.SOURCE_PATH_TEMPLATE;
    const path = template.replace('{username}', encodeURIComponent(username));
    const url = new URL(path, global.location.origin);
    url.searchParams.set('limit', String(C.FETCH.LIMIT_PER_PAGE));
    if (after) {
      url.searchParams.set('after', String(after));
    }
    return url.toString();
  }

  function buildOverviewUrl(username, after) {
    return buildListingUrl(C.FETCH.SOURCE_PATH_TEMPLATE, username, after);
  }

  function parseRetryAfterMs(headers) {
    if (!headers) {
      return null;
    }

    const value = headers.get(C.FETCH.HEADER_RETRY_AFTER);
    if (!value) {
      return null;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric * C.TIME.SECOND_MS;
    }

    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - nowMs());
    }

    return null;
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      global.chrome.storage.local.get(keys, (result) => {
        resolve(result || {});
      });
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      global.chrome.storage.local.set(values, () => {
        resolve();
      });
    });
  }

  function safeIdFromUrl(href) {
    if (!href) {
      return '';
    }
    try {
      const url = new URL(String(href), global.location.origin);
      return String(url.pathname || '')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function createErrorRecord(fields) {
    return Object.assign(
      {
        atIso: new Date().toISOString(),
        atMs: nowMs()
      },
      fields || {}
    );
  }

  root.utils = {
    nowMs,
    toLowerSafe,
    sleep,
    clamp,
    normalizeUsername,
    parseUsernameFromHref,
    isLikelyUsernameAnchor,
    truncateText,
    listTopKeysByValue,
    jaccardIndex,
    buildListingUrl,
    buildOverviewUrl,
    parseRetryAfterMs,
    storageGet,
    storageSet,
    safeIdFromUrl,
    createErrorRecord
  };
})(globalThis);

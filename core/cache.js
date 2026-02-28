(function initCache(global) {
  const root = global.RAB || (global.RAB = {});
  const C = root.constants;
  const U = root.utils;

  const memoryCache = new Map();
  const sourceHintMemory = new Map();

  function createStorageKey(username) {
    return `${C.CACHE.STORAGE_PREFIX}${String(username || '').toLowerCase()}`;
  }

  function createSourceHintKey(username) {
    return `${C.CACHE.SOURCE_HINT_PREFIX}${String(username || '').toLowerCase()}`;
  }

  function trimMemoryCacheIfNeeded() {
    if (memoryCache.size <= C.CACHE.MEMORY_MAX_USERS) {
      return;
    }

    const sortedByAccess = Array.from(memoryCache.entries())
      .sort((a, b) => (a[1].lastAccessMs || 0) - (b[1].lastAccessMs || 0));

    const itemsToRemove = sortedByAccess.slice(0, Math.max(1, sortedByAccess.length - C.CACHE.MEMORY_MAX_USERS));
    itemsToRemove.forEach((entry) => {
      memoryCache.delete(entry[0]);
    });
  }

  function isValidCacheEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    if (!Number.isFinite(entry.expiresAtMs)) {
      return false;
    }

    return entry.expiresAtMs > U.nowMs();
  }

  async function get(username) {
    const key = createStorageKey(username);

    const mem = memoryCache.get(key);
    if (isValidCacheEntry(mem)) {
      mem.lastAccessMs = U.nowMs();
      return mem.payload;
    }

    const stored = await U.storageGet(key);
    const entry = stored[key];
    if (!isValidCacheEntry(entry)) {
      if (entry) {
        await U.storageSet({ [key]: null });
      }
      return null;
    }

    entry.lastAccessMs = U.nowMs();
    memoryCache.set(key, entry);
    trimMemoryCacheIfNeeded();
    return entry.payload;
  }

  function getTtlMsForPayload(payload) {
    const topSubreddits = payload && Array.isArray(payload.topSubreddits)
      ? payload.topSubreddits
      : [];

    if (topSubreddits.length === 0) {
      return C.CACHE.EMPTY_TTL_MS;
    }

    return C.CACHE.TTL_MS;
  }

  async function set(username, payload) {
    const key = createStorageKey(username);
    const now = U.nowMs();
    const ttlMs = getTtlMsForPayload(payload);
    const entry = {
      payload,
      createdAtMs: now,
      expiresAtMs: now + ttlMs,
      ttlMs,
      lastAccessMs: now
    };

    memoryCache.set(key, entry);
    trimMemoryCacheIfNeeded();

    await U.storageSet({ [key]: entry });
    return payload;
  }

  function isValidSourceHint(entry) {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    if (!entry.source || typeof entry.source !== 'string') {
      return false;
    }

    return Number.isFinite(entry.expiresAtMs) && entry.expiresAtMs > U.nowMs();
  }

  async function getSourceHint(username) {
    const key = createSourceHintKey(username);

    const mem = sourceHintMemory.get(key);
    if (isValidSourceHint(mem)) {
      return mem.source;
    }

    const stored = await U.storageGet(key);
    const entry = stored[key];
    if (!isValidSourceHint(entry)) {
      if (entry) {
        await U.storageSet({ [key]: null });
      }
      return null;
    }

    sourceHintMemory.set(key, entry);
    return entry.source;
  }

  async function setSourceHint(username, source) {
    const normalized = String(source || '').trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    const key = createSourceHintKey(username);
    const now = U.nowMs();
    const entry = {
      source: normalized,
      createdAtMs: now,
      expiresAtMs: now + C.CACHE.SOURCE_HINT_TTL_MS
    };

    sourceHintMemory.set(key, entry);
    await U.storageSet({ [key]: entry });
    return normalized;
  }

  async function remove(username) {
    const key = createStorageKey(username);
    memoryCache.delete(key);
    await U.storageSet({ [key]: null });
  }

  async function removeSourceHint(username) {
    const key = createSourceHintKey(username);
    sourceHintMemory.delete(key);
    await U.storageSet({ [key]: null });
  }

  root.cache = {
    get,
    set,
    createStorageKey,
    createSourceHintKey,
    getSourceHint,
    setSourceHint,
    remove,
    removeSourceHint
  };
})(globalThis);

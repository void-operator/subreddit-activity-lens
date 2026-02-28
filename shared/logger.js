(function initLogger(global) {
  const root = global.RAB || (global.RAB = {});
  const C = root.constants;
  const U = root.utils;
  const debugStore = root.debugStore;

  const statusUsers = new Set();

  function shouldLogError() {
    return C.LOGGING.LEVEL === 'error' || C.LOGGING.LEVEL === 'info' || C.LOGGING.LEVEL === 'debug';
  }

  function shouldLogInfo() {
    return C.LOGGING.LEVEL === 'info' || C.LOGGING.LEVEL === 'debug';
  }

  function error(message, meta) {
    if (!shouldLogError()) {
      return;
    }
    if (C.LOGGING.DEBUG_CAPTURE_ENABLED && debugStore && typeof debugStore.push === 'function') {
      debugStore.push('error', { message, meta: meta || null });
    }
    if (meta) {
      console.error('[RAB]', message, meta);
      return;
    }
    console.error('[RAB]', message);
  }

  function info(message, meta) {
    if (!shouldLogInfo()) {
      return;
    }
    if (meta) {
      console.info('[RAB]', message, meta);
      return;
    }
    console.info('[RAB]', message);
  }

  function statusOncePerUser(username, statusText) {
    if (!C.LOGGING.CONSOLE_USER_STATUS_ONCE) {
      return;
    }

    const key = `${String(username || '').toLowerCase()}::${String(statusText || '')}`;
    if (statusUsers.has(key)) {
      return;
    }

    statusUsers.add(key);
    console.info('[RAB]', `${username}: ${statusText}`);

    if (C.LOGGING.DEBUG_CAPTURE_ENABLED && debugStore && typeof debugStore.push === 'function') {
      debugStore.push('status', { username, statusText });
    }
  }

  function formatTimingStamp() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }

  function timing(message, meta) {
    if (!C.LOGGING.TIMING_ENABLED) {
      return;
    }

    if (C.LOGGING.DEBUG_CAPTURE_ENABLED && debugStore && typeof debugStore.push === 'function') {
      debugStore.push('timing', {
        ts: formatTimingStamp(),
        message,
        meta: meta || null
      });
    }

    if (!C.LOGGING.TIMING_CONSOLE_ENABLED) {
      return;
    }

    const prefix = `[RAB T ${formatTimingStamp()}]`;
    if (meta) {
      console.info(prefix, message, meta);
      return;
    }
    console.info(prefix, message);
  }

  async function appendHardFailure(record) {
    const entry = U.createErrorRecord(record);
    try {
      const existing = await U.storageGet(C.STORAGE_KEYS.ERROR_LOGS);
      const currentLogs = Array.isArray(existing[C.STORAGE_KEYS.ERROR_LOGS])
        ? existing[C.STORAGE_KEYS.ERROR_LOGS]
        : [];

      currentLogs.push(entry);
      const trimmedLogs = currentLogs.slice(-C.LOGGING.MAX_ERROR_LOG_ENTRIES);

      await U.storageSet({
        [C.STORAGE_KEYS.ERROR_LOGS]: trimmedLogs
      });
    } catch (storageError) {
      error('failed to persist hard-failure log entry', {
        storageError,
        record: entry
      });
    }
  }

  root.logger = {
    error,
    info,
    timing,
    statusOncePerUser,
    appendHardFailure
  };
})(globalThis);

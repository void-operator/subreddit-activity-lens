(function initPopup() {
  const CACHE_PREFIX = 'rab:cache:';
  const SOURCE_HINT_PREFIX = 'rab:source:';
  const ERROR_LOGS_KEY = 'rab:hardFailureLogs:v1';
  const DEBUG_KEY = 'rab:debug:v1';
  const OPTIONS_KEY = 'rab:options:v1';

  const autoScanCheckbox = document.getElementById('auto-scan');
  const hideBadgesCheckbox = document.getElementById('hide-badges');
  const showHiddenCheckbox = document.getElementById('show-hidden');
  const runPageButton = document.getElementById('run-page');
  const cancelInflightButton = document.getElementById('cancel-inflight');
  const clearCacheButton = document.getElementById('clear-cache');
  const clearLogsButton = document.getElementById('clear-logs');
  const copyDebugButton = document.getElementById('copy-debug');
  const clearDebugButton = document.getElementById('clear-debug');
  const inflightNode = document.getElementById('inflight');
  const statusNode = document.getElementById('status');
  const versionNode = document.getElementById('version');

  function setStatus(message) {
    statusNode.textContent = message;
  }

  function loadVersionTag() {
    if (!versionNode) {
      return;
    }
    try {
      const manifest = chrome.runtime.getManifest();
      const version = manifest && manifest.version ? String(manifest.version) : '0.0.0';
      versionNode.textContent = `v${version}`;
    } catch (_) {
      versionNode.textContent = 'v0.0.0';
    }
  }

  function storageGetAll() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (result) => {
        resolve(result || {});
      });
    });
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      chrome.storage.local.set(values, () => resolve());
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      if (!Array.isArray(keys) || keys.length === 0) {
        resolve();
        return;
      }
      chrome.storage.local.remove(keys, () => resolve());
    });
  }

  async function clearCache() {
    setStatus('Clearing activity cache...');
    const all = await storageGetAll();
    const keys = Object.keys(all).filter((key) => key.startsWith(CACHE_PREFIX) || key.startsWith(SOURCE_HINT_PREFIX));
    await storageRemove(keys);
    setStatus(`Cleared ${keys.length} cache key(s).`);
  }


  async function loadOptions() {
    loadVersionTag();
    const got = await storageGet([OPTIONS_KEY]);
    const opt = got[OPTIONS_KEY] && typeof got[OPTIONS_KEY] === 'object' ? got[OPTIONS_KEY] : {};
    const hideBadges = opt.hideBadges === true || (typeof opt.hideBadges !== 'boolean' && opt.enabled === false);
    const autoScan = !hideBadges && opt.autoScan !== false;
    const showHiddenIndicator = opt.showHiddenIndicator !== false;

    if (autoScanCheckbox) {
      autoScanCheckbox.checked = autoScan;
      autoScanCheckbox.disabled = hideBadges;
    }
    if (hideBadgesCheckbox) {
      hideBadgesCheckbox.checked = hideBadges;
    }
    if (showHiddenCheckbox) {
      showHiddenCheckbox.checked = showHiddenIndicator;
      showHiddenCheckbox.disabled = hideBadges;
    }

    if (runPageButton) {
      runPageButton.disabled = hideBadges;
    }
    if (cancelInflightButton) {
      cancelInflightButton.disabled = hideBadges;
    }

    if (hideBadges) {
      setStatus('Badges hidden (auto-scan paused).');
    } else {
      setStatus(autoScan ? 'Auto-scan enabled.' : 'Auto-scan paused.');
    }

    await refreshDiagnostics();
  }

  async function saveOptionsPatch(patch) {
    const got = await storageGet([OPTIONS_KEY]);
    const opt = got[OPTIONS_KEY] && typeof got[OPTIONS_KEY] === 'object' ? got[OPTIONS_KEY] : {};
    Object.assign(opt, patch || {});
    await storageSet({ [OPTIONS_KEY]: opt });
  }

  async function runCurrentPage() {
    setStatus('Triggering manual run...');
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0] ? tabs[0] : null;
        if (!tab || typeof tab.id !== 'number') {
          setStatus('No active tab.');
          resolve();
          return;
        }

        chrome.tabs.sendMessage(tab.id, { type: 'rab-run-page' }, () => {
          const err = chrome.runtime.lastError;
          if (err) {
            console.error('[RAB popup] failed to message tab', err);
            setStatus('Failed to trigger run (open a reddit.com tab).');
            resolve();
            return;
          }

          setStatus('Scan triggered.');
          resolve();
        });
      });
    });
  }

  async function cancelInFlight() {
    setStatus('Cancelling active scans...');
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0] ? tabs[0] : null;
        if (!tab || typeof tab.id !== 'number') {
          setStatus('No active tab.');
          resolve();
          return;
        }

        chrome.tabs.sendMessage(tab.id, { type: 'rab-cancel-inflight' }, () => {
          const err = chrome.runtime.lastError;
          if (err) {
            console.error('[RAB popup] failed to cancel in-flight', err);
            setStatus('Failed to cancel (open a reddit.com tab).');
            resolve();
            return;
          }
          setStatus('Cancelled.');
          resolve();
        });
      });
    });
  }

  async function refreshDiagnostics() {
    if (!inflightNode) {
      return;
    }

    inflightNode.textContent = '…';
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0] ? tabs[0] : null;
        if (!tab || typeof tab.id !== 'number') {
          inflightNode.textContent = 'n/a';
          resolve();
          return;
        }

        chrome.tabs.sendMessage(tab.id, { type: 'rab-get-stats' }, (resp) => {
          const err = chrome.runtime.lastError;
          if (err || !resp || typeof resp !== 'object') {
            inflightNode.textContent = 'n/a';
            resolve();
            return;
          }

          const inFlight = Number(resp.inFlightUsers);
          inflightNode.textContent = Number.isFinite(inFlight) ? String(inFlight) : '0';
          resolve();
        });
      });
    });
  }

  async function clearLogs() {
    setStatus('Clearing error logs...');
    await storageRemove([ERROR_LOGS_KEY]);
    setStatus('Cleared error logs.');
  }

  async function copyDebugBundle() {
    setStatus('Preparing debug bundle...');
    const all = await storageGetAll();
    const bundle = {
      atIso: new Date().toISOString(),
      keys: {
        errorLogs: ERROR_LOGS_KEY,
        debug: DEBUG_KEY
      },
      debug: Array.isArray(all[DEBUG_KEY]) ? all[DEBUG_KEY] : [],
      errorLogs: Array.isArray(all[ERROR_LOGS_KEY]) ? all[ERROR_LOGS_KEY] : [],
      cacheKeyCount: Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX) || k.startsWith(SOURCE_HINT_PREFIX)).length
    };

    const text = JSON.stringify(bundle, null, 2);

    try {
      await navigator.clipboard.writeText(text);
      setStatus(`Copied debug bundle (${bundle.debug.length} events).`);
    } catch (error) {
      console.error('[RAB popup] failed to copy to clipboard', error);
      setStatus(`Clipboard blocked. Bundle size ${text.length} chars (open console to copy).`);
      // Fallback: log to popup console so user can copy.
      console.log('[RAB debug bundle]', bundle);
    }
  }

  async function clearDebugBundle() {
    setStatus('Clearing debug bundle...');
    await storageRemove([DEBUG_KEY]);
    setStatus('Cleared debug bundle.');
  }

  function onClick(node, handler) {
    if (!node) {
      return;
    }
    node.addEventListener('click', () => {
      handler().catch((error) => {
        console.error('[RAB popup] action failed', error);
        setStatus('Action failed.');
      });
    });
  }

  if (clearCacheButton) {
    onClick(clearCacheButton, async () => {
      await clearCache();
    });
  }


  if (autoScanCheckbox) {
    autoScanCheckbox.addEventListener('change', () => {
      saveOptionsPatch({ autoScan: autoScanCheckbox.checked })
        .then(() => loadOptions())
        .catch((error) => {
          console.error('[RAB popup] failed to save auto-scan flag', error);
          setStatus('Failed to save option.');
        });
    });
  }

  if (hideBadgesCheckbox) {
    hideBadgesCheckbox.addEventListener('change', () => {
      const hide = Boolean(hideBadgesCheckbox.checked);
      // No surprises: hiding badges pauses auto-scan.
      const patch = hide ? { hideBadges: true, autoScan: false } : { hideBadges: false };
      saveOptionsPatch(patch)
        .then(() => loadOptions())
        .catch((error) => {
          console.error('[RAB popup] failed to save hide-badges flag', error);
          setStatus('Failed to save option.');
        });
    });
  }

  if (showHiddenCheckbox) {
    showHiddenCheckbox.addEventListener('change', () => {
      saveOptionsPatch({ showHiddenIndicator: showHiddenCheckbox.checked })
        .then(() => loadOptions())
        .catch((error) => {
          console.error('[RAB popup] failed to save hidden-indicator flag', error);
          setStatus('Failed to save option.');
        });
    });
  }

  if (runPageButton) {
    onClick(runPageButton, async () => {
      await runCurrentPage();
    });
  }

  if (cancelInflightButton) {
    onClick(cancelInflightButton, async () => {
      await cancelInFlight();
      await refreshDiagnostics();
    });
  }

  if (clearLogsButton) {
    onClick(clearLogsButton, async () => {
      await clearLogs();
    });
  }

  if (copyDebugButton) {
    onClick(copyDebugButton, async () => {
      await copyDebugBundle();
    });
  }

  if (clearDebugButton) {
    onClick(clearDebugButton, async () => {
      await clearDebugBundle();
    });
  }

  loadOptions().catch((error) => {
    console.error('[RAB popup] failed to load options', error);
  });

  // While the popup is open, keep the diagnostics fresh.
  if (inflightNode) {
    setInterval(() => {
      refreshDiagnostics().catch(() => {});
    }, 1000);
  }
})();

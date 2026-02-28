(function initRenderer(global) {
  const root = global.RAB || (global.RAB = {});
  const C = root.constants;
  const U = root.utils;

  let styleInjected = false;

  function injectStyleOnce() {
    if (styleInjected) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'rab-badge-style';
    style.textContent = [
      `.${C.UI.ROOT_CLASS} { margin-top: 4px; }`,
      `.${C.UI.ROW_CLASS} { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }`,
      `.${C.UI.BADGE_CLASS} {`,
      '  display: inline-flex;',
      '  align-items: center;',
      '  border-radius: 999px;',
      '  overflow: hidden;',
      '  white-space: nowrap;',
      '  font-size: 10.5px;',
      '  line-height: 1.2;',
      '  color: var(--color-neutral-content-strong, #1f2937);',
      '  text-decoration: none;',
      '}',
      `.${C.UI.BADGE_CLASS} .rab-sub {`,
      '  background: color-mix(in srgb, var(--color-neutral-content-weak, #bcd0dd) 28%, transparent);',
      '  padding: 2px 7px;',
      '}',
      `.${C.UI.BADGE_CLASS} .rab-count {`,
      '  background: color-mix(in srgb, #3a4fcf 85%, #000 15%);',
      '  color: #eef2ff;',
      '  padding: 2px 7px;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '}',
      `.${C.UI.BADGE_CLASS} a { color: inherit; text-decoration: none; }`,
      `.${C.UI.BADGE_CLASS} a:hover { text-decoration: underline; }`,
      `.${C.UI.BADGE_CLASS} .rab-sub a:hover { text-decoration: none; }`,
      `.${C.UI.BADGE_CLASS} .rab-divider { opacity: 0.7; }`,
      `.${C.UI.STATE_CLASS} { font-size: 11px; opacity: 0.75; }`
      ,
      `.rab-scan-chip {`,
      '  display: inline-flex;',
      '  align-items: center;',
      '  border-radius: 999px;',
      '  padding: 2px 7px;',
      '  font-size: 10.5px;',
      '  line-height: 1.2;',
      '  color: var(--color-neutral-content-weak, #6b7280);',
      '  background: color-mix(in srgb, var(--color-neutral-content-weak, #bcd0dd) 18%, transparent);',
      '}'
      ,
      `.rab-more-chip {`,
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  appearance: none;',
      '  -webkit-appearance: none;',
      '  font-family: inherit;',
      '  border-radius: 999px;',
      // Reddit's global button styles can affect height; pin it to match chips.
      '  box-sizing: border-box;',
      '  margin: 0 !important;',
      '  height: 17px !important;',
      '  padding: 0 7px !important;',
      '  min-width: 22px;',
      '  min-height: 0 !important;',
      '  font-size: 10.5px;',
      '  line-height: 1 !important;',
      '  color: var(--color-neutral-content-weak, #6b7280);',
      '  background: color-mix(in srgb, var(--color-neutral-content-weak, #bcd0dd) 18%, transparent);',
      '  border: 0;',
      '  cursor: pointer;',
      '}',
      `.rab-more-chip:hover {`,
      '  filter: brightness(1.08);',
      '}'
      ,
      `.rab-scan-btn {`,
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  appearance: none;',
      '  -webkit-appearance: none;',
      '  font-family: inherit;',
      '  border-radius: 999px;',
      '  box-sizing: border-box;',
      '  margin: 0 !important;',
      '  height: 17px !important;',
      '  padding: 0 9px !important;',
      '  min-width: 40px;',
      '  min-height: 0 !important;',
      '  font-size: 10.5px;',
      '  line-height: 1 !important;',
      '  color: var(--color-neutral-content-weak, #6b7280);',
      '  background: color-mix(in srgb, var(--color-neutral-content-weak, #bcd0dd) 18%, transparent);',
      '  border: 0;',
      '  cursor: pointer;',
      '}',
      `.rab-scan-btn:hover {`,
      '  filter: brightness(1.08);',
      '}'
      ,
      `.rab-retry-btn {`,
      '  margin-left: 0.5em;',
      '  border: 0;',
      '  border-radius: 999px;',
      '  padding: 1px 8px;',
      '  font-size: 10.5px;',
      '  line-height: 1.2;',
      '  cursor: pointer;',
      '  color: #eef2ff;',
      '  background: color-mix(in srgb, #3a4fcf 85%, #000 15%);',
      '}',
      `.rab-retry-btn:hover {`,
      '  filter: brightness(1.08);',
      '}'
    ].join('\n');

    document.documentElement.appendChild(style);
    styleInjected = true;
  }

  function ensureMountContainer(anchor, username) {
    const key = String(username || '').toLowerCase();

    let targetContainer = null;
    const authorMeta = anchor.closest('.author-name-meta');

    if (authorMeta && authorMeta.parentElement) {
      const maybeColumn = authorMeta.parentElement.closest('.flex.flex-col.overflow-hidden');
      if (maybeColumn && maybeColumn instanceof HTMLElement) {
        targetContainer = maybeColumn;
      } else {
        targetContainer = authorMeta.parentElement;
      }
    }

    if (!targetContainer) {
      targetContainer = anchor.parentElement || anchor;
    }

    const selector = `.${C.UI.ROOT_CLASS}[${C.UI.MOUNT_ATTR}="${key}"]`;
    let rootEl = targetContainer.querySelector(selector);

    if (!rootEl) {
      rootEl = document.createElement('div');
      rootEl.className = C.UI.ROOT_CLASS;
      rootEl.setAttribute(C.UI.MOUNT_ATTR, key);

      if (targetContainer === anchor.parentElement || targetContainer === anchor) {
        anchor.insertAdjacentElement('afterend', rootEl);
      } else {
        const row = targetContainer.querySelector('.flex.flex-none.flex-row.flex-nowrap.items-center')
          || targetContainer.firstElementChild;

        if (row && row.parentElement === targetContainer) {
          row.insertAdjacentElement('afterend', rootEl);
        } else {
          targetContainer.appendChild(rootEl);
        }
      }
    }

    return rootEl;
  }

  function renderLoading(anchor, username) {
    injectStyleOnce();
    const rootEl = ensureMountContainer(anchor, username);
    rootEl.innerHTML = `<div class="${C.UI.STATE_CLASS}">loading…</div>`;
  }

  function renderError(anchor, username, errorInfo) {
    injectStyleOnce();
    const rootEl = ensureMountContainer(anchor, username);
    const isRateLimited = Boolean(errorInfo && errorInfo.isRateLimited);
    const label = isRateLimited ? 'rate limited…' : 'activity unavailable';
    const title = isRateLimited ? 'Too many requests. Wait a bit, then retry.' : '';
    const retryBtn = `<button type="button" class="rab-retry-btn" data-rab-retry-user="${escapeHtml(String(username || ''))}">Retry</button>`;
    rootEl.innerHTML = `<div class="${C.UI.STATE_CLASS}" title="${escapeHtml(title)}">${label}${retryBtn}</div>`;
  }

  function renderScan(anchor, username, opts) {
    injectStyleOnce();
    const rootEl = ensureMountContainer(anchor, username);
    const safeUser = escapeHtml(String(username || ''));
    const options = opts && typeof opts === 'object' ? opts : {};
    const reason = options.reason ? String(options.reason) : '';
    const title = reason === 'moderators-pane'
      ? 'Auto-scan is disabled in the Moderators pane. Click to scan.'
      : 'Auto-scan is paused. Click to scan.';
    rootEl.innerHTML = [
      `<div class="${C.UI.ROW_CLASS}">`,
      `<button type="button" class="rab-scan-btn" data-rab-scan-user="${safeUser}" title="${escapeHtml(title)}">scan</button>`,
      '</div>'
    ].join('');
  }

  function renderBadges(anchor, username, snapshot) {
    injectStyleOnce();
    const rootEl = ensureMountContainer(anchor, username);

    const mode = C.UI.BADGE_MODE_DEFAULT;
    const ranked = Array.isArray(snapshot && snapshot.rankedSubreddits)
      ? snapshot.rankedSubreddits
      : (Array.isArray(snapshot && snapshot.topSubreddits) ? snapshot.topSubreddits : []);
    const items = ranked;
    const historyUnavailable = Boolean(snapshot && snapshot.flags && snapshot.flags.historyUnavailable);
    const refining = Boolean(snapshot && snapshot.flags && snapshot.flags.refining);
    const hiddenProfile = Boolean(snapshot && snapshot.flags && snapshot.flags.hiddenProfile);
    const postsOnly = Boolean(snapshot && snapshot.flags && snapshot.flags.searchPostsOnly);
    const viewId = snapshot && snapshot.flags && typeof snapshot.flags.activityViewId === 'string'
      ? snapshot.flags.activityViewId
      : '';

    try {
      if (root.metaLinks && typeof root.metaLinks.setHiddenIndicator === 'function') {
        const allow = !(root.runtimeOptions && root.runtimeOptions.showHiddenIndicator === false);
        root.metaLinks.setHiddenIndicator(anchor, username, allow ? hiddenProfile : false);
      }
    } catch (_) {
      // ignore
    }

    if (items.length === 0) {
      const label = historyUnavailable
        ? 'profile history unavailable'
        : 'no public 30d activity';
      const src = snapshot && snapshot.flags && snapshot.flags.source ? String(snapshot.flags.source) : 'n/a';
      const pages = snapshot && snapshot.stats && Number.isFinite(snapshot.stats.pagesFetched) ? snapshot.stats.pagesFetched : 0;
      const seen = snapshot && snapshot.stats && Number.isFinite(snapshot.stats.itemsProcessed) ? snapshot.stats.itemsProcessed : 0;
      const in30 = snapshot && snapshot.stats && Number.isFinite(snapshot.stats.inWindowItemsCount) ? snapshot.stats.inWindowItemsCount : 0;
      const debug = `src=${src} pages=${pages} seen=${seen} in30=${in30}`;
      rootEl.innerHTML = `<div class="${C.UI.STATE_CLASS}" title="${escapeHtml(debug)}">${label}</div>`;
      return;
    }

    const visibleFromDom = rootEl && rootEl.dataset ? Number(rootEl.dataset.rabVisibleCount || '') : NaN;
    const defaultVisible = C.DATA_WINDOW.TOP_BADGES;
    // Persist "show more" expansions, but if we previously had <5 items and later learn more,
    // auto-expand back up to the default instead of staying stuck at the old smaller count.
    const visibleCount = (Number.isFinite(visibleFromDom) && visibleFromDom > defaultVisible)
      ? Math.min(visibleFromDom, items.length)
      : Math.min(defaultVisible, items.length);
    rootEl.dataset.rabVisibleCount = String(visibleCount);

    ensureMoreHandler(rootEl);

    const badgesMarkup = items.map((entry, idx) => {
      const sub = U.truncateText(entry.subreddit, C.UI.BADGE_MAX_SUBREDDIT_LENGTH);
      const showComments = !(hiddenProfile || postsOnly);
      const detailedCount = showComments ? `${entry.posts}p • ${entry.comments}c` : `${entry.posts}p`;
      const compactCount = `${entry.totalRaw}x`;
      const visibleCountText = mode === C.UI.BADGE_MODE_OPTIONS.COMPACT ? compactCount : detailedCount;
      const title = showComments
        ? `Score ${entry.score}: ${entry.posts} posts + ${entry.comments} comments`
        : `Score ${entry.score}: ${entry.posts} posts`;
      const hiddenStyle = idx >= Number(rootEl.dataset.rabVisibleCount || 0) ? ' style="display:none"' : '';
      const hiddenAttr = idx >= Number(rootEl.dataset.rabVisibleCount || 0) ? ' data-rab-hidden="1"' : '';

      const subredditUrl = `https://www.reddit.com/r/${encodeURIComponent(entry.subreddit)}`;
      const searchQuery = `subreddit:${entry.subreddit}`;
      const userPart = encodeURIComponent(String(username || ''));
      const qPart = encodeURIComponent(searchQuery);
      const postSearchUrl = viewId
        ? `chrome-extension://${globalThis.chrome && chrome.runtime ? chrome.runtime.id : ''}/activity-view.html?id=${encodeURIComponent(viewId)}`
        : `https://www.reddit.com/user/${userPart}/search/?q=${qPart}&type=posts&sort=${encodeURIComponent(C.SEARCH.SORT)}&t=${encodeURIComponent(C.SEARCH.TIME_RANGE)}`;
      const commentSearchUrl = showComments
        ? `https://www.reddit.com/user/${userPart}/search/?q=${qPart}&type=comments&sort=${encodeURIComponent(C.SEARCH.SORT)}&t=${encodeURIComponent(C.SEARCH.TIME_RANGE)}`
        : '';

      return [
        `<span class="${C.UI.BADGE_CLASS}" title="${escapeHtml(title)}"${hiddenStyle}${hiddenAttr}>`,
        `<span class="rab-sub"><a href="${subredditUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(sub)}</a></span>`,
        mode === C.UI.BADGE_MODE_OPTIONS.COMPACT
          ? `<span class="rab-count">${escapeHtml(visibleCountText)}</span>`
          : [
              '<span class="rab-count">',
              `<a href="${postSearchUrl}" target="_blank" rel="noopener noreferrer" aria-label="View posts in r/${escapeHtml(entry.subreddit)} for ${escapeHtml(username)}">${escapeHtml(String(entry.posts))}p</a>`,
              showComments
                ? '<span class="rab-divider">•</span>'
                : '',
              showComments
                ? `<a href="${commentSearchUrl}" target="_blank" rel="noopener noreferrer" aria-label="View comments in r/${escapeHtml(entry.subreddit)} for ${escapeHtml(username)}">${escapeHtml(String(entry.comments))}c</a>`
                : '',
              '</span>'
            ].join(''),
        '</span>'
      ].join('');
    }).join('');

    const showMoreRemaining = Math.max(0, items.length - Number(rootEl.dataset.rabVisibleCount || 0));
    const moreMarkup = showMoreRemaining > 0
      ? `<button type="button" class="rab-more-chip" data-rab-more="1" title="Show more">+</button>`
      : '';

    const refineMarkup = refining
      ? `<span class="rab-scan-chip" title="Scanning for more activity…">scanning…</span>`
      : '';

    rootEl.innerHTML = `<div class="${C.UI.ROW_CLASS}">${badgesMarkup}${moreMarkup}${refineMarkup}</div>`;
  }

  function ensureMoreHandler(rootEl) {
    if (!rootEl || !rootEl.dataset) {
      return;
    }
    if (rootEl.dataset.rabMoreHandler === '1') {
      return;
    }
    rootEl.dataset.rabMoreHandler = '1';

    rootEl.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const btn = target.closest && target.closest('button[data-rab-more="1"]');
      if (!btn) {
        return;
      }

      event.stopPropagation();
      event.preventDefault();

      const currentVisible = Number(rootEl.dataset.rabVisibleCount || 0);
      const nextVisible = Math.max(0, currentVisible) + C.UI.SHOW_MORE_STEP;
      rootEl.dataset.rabVisibleCount = String(nextVisible);

      // Reveal next hidden chips.
      const hidden = Array.from(rootEl.querySelectorAll(`.${C.UI.BADGE_CLASS}[data-rab-hidden="1"]`));
      let revealed = 0;
      for (const node of hidden) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        node.style.display = '';
        node.removeAttribute('data-rab-hidden');
        revealed += 1;
        if (revealed >= C.UI.SHOW_MORE_STEP) {
          break;
        }
      }

      // Remove + button if nothing left to show.
      const remaining = rootEl.querySelectorAll(`.${C.UI.BADGE_CLASS}[data-rab-hidden="1"]`).length;
      if (remaining === 0) {
        btn.remove();
      }
    }, true);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  root.renderer = {
    renderLoading,
    renderBadges,
    renderError,
    renderScan
  };
})(globalThis);

(function initMetaLinks(global) {
  const root = global.RAB || (global.RAB = {});
  const C = root.constants;
  const U = root.utils;

  const WRAP_CLASS = 'rab-meta-links';
  const SEP_CLASS = 'rab-meta-links-sep';
  const HIDDEN_CLASS = 'rab-hidden-indicator';
  const TIMESTAMP_SELECTOR = [
    'a[data-testid*="timestamp"]',
    'span[data-testid*="timestamp"]',
    'faceplate-timeago',
    'time'
  ].join(', ');

  function buildUserSearchUrl(username, type) {
    const safeType = type === C.SEARCH.TYPE_OPTIONS.POSTS ? C.SEARCH.TYPE_OPTIONS.POSTS : C.SEARCH.TYPE_OPTIONS.COMMENTS;
    const url = new URL(`/user/${encodeURIComponent(String(username || ''))}/search/`, 'https://www.reddit.com');
    url.searchParams.set('q', C.SEARCH.QUERY_VALUE);
    url.searchParams.set('type', safeType);
    url.searchParams.set('sort', C.SEARCH.SORT);
    url.searchParams.set('t', C.SEARCH.TIME_RANGE);
    return url.toString();
  }

  function findTimestampElement(anchor) {
    let node = anchor;
    for (let depth = 0; depth < C.SEARCH.MAX_TIME_LOOKUP_HOPS && node; depth += 1) {
      if (node.querySelector) {
        const timeElement = node.querySelector(TIMESTAMP_SELECTOR);
        if (timeElement) {
          return timeElement;
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  function resolveInsertionTarget(anchor, timestamp) {
    if (!timestamp) {
      return anchor;
    }

    const timestampAnchor = timestamp.closest('a');
    if (timestampAnchor && timestampAnchor.contains(timestamp)) {
      return timestampAnchor;
    }

    return timestamp;
  }

  function hasExistingMetaLinks(username, insertionTarget) {
    const userKey = U.toLowerSafe(String(username || ''));
    const selector = `.${WRAP_CLASS}[data-rab-user="${userKey}"]`;
    if (!insertionTarget || !insertionTarget.parentElement) {
      return false;
    }

    let nextNode = insertionTarget.nextElementSibling;
    for (let i = 0; i < 6 && nextNode; i += 1) {
      if (nextNode.matches && nextNode.matches(selector)) {
        return true;
      }
      nextNode = nextNode.nextElementSibling;
    }

    return false;
  }

  function createRedditStyleSeparator() {
    const separator = document.createElement('span');
    separator.className = `${SEP_CLASS} inline-block my-0 mx-2xs text-12 text-neutral-content-weak`;
    separator.setAttribute('aria-hidden', 'true');
    separator.textContent = '\u2022';

    // Fallbacks (Reddit utility classes vary across surfaces).
    separator.style.display = 'inline-block';
    separator.style.margin = '0 0.25em';
    separator.style.verticalAlign = 'middle';
    return separator;
  }

  function stopRedditClickConsumption(node) {
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((type) => {
      node.addEventListener(type, (event) => {
        event.stopPropagation();
      }, true);
    });
  }

  function createLink(label, href) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.textDecoration = 'none';
    link.style.cursor = 'pointer';
    link.style.display = 'inline-flex';
    link.style.alignItems = 'center';
    link.style.lineHeight = '1';
    stopRedditClickConsumption(link);
    return link;
  }

  function setHiddenIndicator(anchor, username, isHidden) {
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }

    const userKey = U.toLowerSafe(String(username || ''));

    const selector = `.${HIDDEN_CLASS}[data-rab-user="${userKey}"]`;

    // Prefer attaching the indicator to our injected meta links. This avoids disrupting
    // Reddit's author pill layout on feed surfaces.
    let wrap = null;
    try {
      const timestamp = findTimestampElement(anchor);
      const insertionTarget = resolveInsertionTarget(anchor, timestamp);
      let node = insertionTarget && insertionTarget.parentElement ? insertionTarget.nextElementSibling : null;
      for (let i = 0; i < 8 && node; i += 1) {
        if (node.matches && node.matches(`.${WRAP_CLASS}[data-rab-user="${userKey}"]`)) {
          wrap = node;
          break;
        }
        node = node.nextElementSibling;
      }
    } catch (_) {
      // ignore
    }

    const existing = wrap
      ? wrap.querySelector(selector)
      : (anchor.parentElement ? anchor.parentElement.querySelector(selector) : null);

    if (!isHidden) {
      if (existing) {
        existing.remove();
      }
      return;
    }

    if (existing) {
      return;
    }

    const badge = document.createElement('span');
    badge.className = HIDDEN_CLASS;
    badge.dataset.rabUser = userKey;
    badge.textContent = '😎';
    badge.title = 'Hidden profile';
    badge.setAttribute('aria-label', 'Hidden profile');
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.verticalAlign = 'middle';
    badge.style.marginLeft = '0.4em';
    badge.style.fontSize = '11px';
    badge.style.lineHeight = '1';
    badge.style.opacity = '0.85';

    stopRedditClickConsumption(badge);
    if (wrap) {
      wrap.appendChild(badge);
    } else {
      anchor.insertAdjacentElement('afterend', badge);
    }
  }

  function attachMetaLinks(anchor, username) {
    if (!(anchor instanceof HTMLAnchorElement) || !anchor.href) {
      return;
    }

    if (anchor.closest('.' + WRAP_CLASS)) {
      return;
    }

    const timestamp = findTimestampElement(anchor);
    if (!timestamp) {
      return;
    }

    const insertionTarget = resolveInsertionTarget(anchor, timestamp);
    if (hasExistingMetaLinks(username, insertionTarget)) {
      return;
    }

    const userKey = U.toLowerSafe(String(username || ''));
    const wrap = document.createElement('span');
    wrap.className = WRAP_CLASS;
    wrap.dataset.rabUser = userKey;
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.verticalAlign = 'middle';
    wrap.style.whiteSpace = 'nowrap';
    wrap.style.gap = '0.35em';
    wrap.style.opacity = '0.95';

    // Match Reddit meta styling without depending on their classes.
    wrap.style.fontSize = '12px';
    wrap.style.color = 'var(--color-neutral-content-weak, #6b7280)';

    const postsUrl = buildUserSearchUrl(username, C.SEARCH.TYPE_OPTIONS.POSTS);
    const commentsUrl = buildUserSearchUrl(username, C.SEARCH.TYPE_OPTIONS.COMMENTS);

    const postsLink = createLink('posts', postsUrl);
    const pipe = document.createElement('span');
    pipe.textContent = '|';
    pipe.setAttribute('aria-hidden', 'true');
    pipe.style.opacity = '0.7';
    const commentsLink = createLink('comments', commentsUrl);

    wrap.appendChild(postsLink);
    wrap.appendChild(pipe);
    wrap.appendChild(commentsLink);

    const separator = createRedditStyleSeparator();
    insertionTarget.insertAdjacentElement('afterend', separator);
    separator.insertAdjacentElement('afterend', wrap);
  }

  root.metaLinks = {
    attachMetaLinks,
    setHiddenIndicator
  };
})(globalThis);

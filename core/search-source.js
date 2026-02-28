(function initSearchSource(global) {
  const root = global.RAB || (global.RAB = {});
  const C = root.constants;
  const U = root.utils;

  function buildInitialSearchUrl(username, type) {
    const path = C.SEARCH.SVC_USER_SEARCH_PATH_TEMPLATE.replace('{username}', encodeURIComponent(username));
    const url = new URL(path, global.location.origin);
    url.searchParams.set('q', C.SEARCH.QUERY_VALUE);
    url.searchParams.set('type', type);
    url.searchParams.set('sort', C.SEARCH.SORT);
    url.searchParams.set('t', C.SEARCH.TIME_RANGE);
    return url.toString();
  }

  function buildSearchJsonUrl(username, after) {
    const url = new URL('/search/.json', global.location.origin);
    const safeUser = String(username || '').trim();
    url.searchParams.set('q', `author:${safeUser}`);
    url.searchParams.set('type', C.SEARCH.TYPE_OPTIONS.POSTS);
    url.searchParams.set('sort', C.SEARCH.SORT);
    url.searchParams.set('t', C.SEARCH.TIME_RANGE);
    url.searchParams.set('limit', String(C.FETCH.LIMIT_PER_PAGE));
    if (after) {
      url.searchParams.set('after', String(after));
    }
    return url.toString();
  }

  function parseResultLinkHref(href) {
    if (!href) {
      return null;
    }

    let url;
    try {
      url = new URL(href, global.location.origin);
    } catch (_) {
      return null;
    }

    const regex = new RegExp(C.SEARCH.RESULT_LINK_PATTERN, 'i');
    const match = url.pathname.match(regex);
    if (!match) {
      return null;
    }

    return {
      subreddit: U.normalizeUsername(match[1]),
      postId: match[2],
      slug: match[3],
      commentId: match[4] || null,
      permalink: url.pathname
    };
  }

  function decodeHtmlAttributeValue(value) {
    return String(value || '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  function extractCommentCandidateHrefs(html) {
    const pattern = /href="([^"]*\/comments\/[^"]*)"/gi;
    const hrefs = [];
    let match = pattern.exec(String(html || ''));

    while (match) {
      hrefs.push(decodeHtmlAttributeValue(match[1]));
      match = pattern.exec(String(html || ''));
    }

    return hrefs;
  }

  function parseNextUrl(doc, username, currentUrl) {
    const partialNodes = Array.from(doc.querySelectorAll(C.SEARCH.NEXT_PARTIAL_SELECTOR));
    if (partialNodes.length === 0) {
      return null;
    }

    const usernamePart = `/svc/shreddit/user/${String(username || '').toLowerCase()}/search/`;

    for (const node of partialNodes) {
      const src = node.getAttribute('src');
      if (!src) {
        continue;
      }

      let next;
      try {
        next = new URL(src, global.location.origin).toString();
      } catch (_) {
        continue;
      }

      if (!next.toLowerCase().includes(usernamePart)) {
        continue;
      }

      if (next === currentUrl) {
        continue;
      }

      return next;
    }

    return null;
  }

  function parseItemsFromHtml(html, expectedType, username, currentUrl, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html || ''), 'text/html');
    const hrefs = extractCommentCandidateHrefs(html);
    const itemsByKey = new Map();
    const nowUtcSec = Math.floor(U.nowMs() / C.TIME.SECOND_MS);
    const userPart = `user/${String(username || '').toLowerCase()}/`;
    let userMatchCount = 0;

    hrefs.forEach((href) => {
      const parsedLink = parseResultLinkHref(href);
      if (!parsedLink) {
        return;
      }

      const rawHref = String(href || '').toLowerCase();
      if (rawHref.includes(userPart)) {
        userMatchCount += 1;
      }

      const isCommentResult = Boolean(parsedLink.commentId);
      if (expectedType === C.SEARCH.TYPE_OPTIONS.COMMENTS && !isCommentResult) {
        return;
      }
      if (expectedType === C.SEARCH.TYPE_OPTIONS.POSTS && isCommentResult) {
        return;
      }

      const key = `${expectedType}:${parsedLink.subreddit}:${parsedLink.postId}:${parsedLink.commentId || '-'}`;
      if (itemsByKey.has(key)) {
        return;
      }

      // Search query already scopes to month; use deterministic "now" to avoid fragile DOM time parsing.
      const createdUtcSec = nowUtcSec;
      const itemKind = isCommentResult ? 't1' : 't3';

      itemsByKey.set(key, {
        rabKey: key,
        kind: itemKind,
        data: {
          name: `rab:${key}`,
          subreddit: parsedLink.subreddit,
          created_utc: createdUtcSec
        }
      });
    });

    return {
      items: Array.from(itemsByKey.values()),
      nextUrl: parseNextUrl(doc, username, currentUrl),
      userMatchCount
    };
  }

  function parseItemsFromSearchJson(payload) {
    const data = payload && payload.data ? payload.data : null;
    const children = data && Array.isArray(data.children) ? data.children : [];
    const after = data && data.after ? data.after : null;
    const nowUtcSec = Math.floor(U.nowMs() / C.TIME.SECOND_MS);
    const items = [];
    const seenKeys = new Set();
    const seenSubreddits = new Set();

    children.forEach((child) => {
      if (!child || child.kind !== 't3' || !child.data) {
        return;
      }
      const rawSub = String(child.data.subreddit || '').trim();
      if (!rawSub) {
        return;
      }
      const subreddit = U.normalizeUsername(rawSub);
      const postId = child.data.id || child.data.name || child.data.permalink || '';
      const key = `searchjson:posts:${subreddit}:${postId}`;
      if (seenKeys.has(key)) {
        return;
      }
      seenKeys.add(key);
      seenSubreddits.add(String(subreddit).toLowerCase());

      const createdUtcSec = Number.isFinite(Number(child.data.created_utc))
        ? Number(child.data.created_utc)
        : nowUtcSec;

      items.push({
        rabKey: key,
        kind: 't3',
        data: {
          name: `rab:${key}`,
          subreddit,
          created_utc: createdUtcSec,
          permalink: child.data.permalink || null,
          title: child.data.title || null
        }
      });
    });

    return {
      items,
      after,
      uniqueSubreddits: seenSubreddits.size
    };
  }

  async function crawlType(username, type, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const signal = options.signal || null;
    const trackUserMatches = Boolean(options.trackUserMatches);
    const allItems = [];
    const seenKeys = new Set();
    const seenSubreddits = new Set();
    let pagesFetched = 0;
    let userMatchCount = 0;
    let nextUrl = buildInitialSearchUrl(username, type);

    while (nextUrl && pagesFetched < C.SEARCH.MAX_PAGES_PER_TYPE) {
      if (signal && signal.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      const currentUrl = nextUrl;
      const html = await root.fetcher.fetchTextWithRetry(currentUrl, { signal });
      const parsed = parseItemsFromHtml(html, type, username, currentUrl, { trackUserMatches });
      if (trackUserMatches) {
        userMatchCount += Number(parsed.userMatchCount) || 0;
      }
      pagesFetched += 1;

      parsed.items.forEach((item) => {
        const key = String(item && item.rabKey ? item.rabKey : '');
        if (!key) {
          return;
        }
        if (seenKeys.has(key)) {
          return;
        }
        seenKeys.add(key);
        if (item && item.data && item.data.subreddit) {
          seenSubreddits.add(String(item.data.subreddit).toLowerCase());
        }
        allItems.push(item);
      });

      const hasEnoughVolume = allItems.length >= C.SEARCH.MIN_ITEMS_TO_STOP;
      const hasEnoughDiversity = seenSubreddits.size >= C.DATA_WINDOW.TOP_BADGES;
      if (hasEnoughVolume && hasEnoughDiversity) {
        break;
      }

      if (!parsed.nextUrl || parsed.nextUrl === currentUrl) {
        break;
      }

      nextUrl = parsed.nextUrl;
    }

    return {
      items: allItems,
      pagesFetched,
      uniqueSubreddits: seenSubreddits.size,
      userMatchCount
    };
  }

  async function crawlSearchJsonPosts(username, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const signal = options.signal || null;
    const allItems = [];
    const seenKeys = new Set();
    const seenSubreddits = new Set();
    let pagesFetched = 0;
    let after = null;

    while (pagesFetched < C.SEARCH.MAX_PAGES_PER_TYPE) {
      if (signal && signal.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }

      const url = buildSearchJsonUrl(username, after);
      const text = await root.fetcher.fetchTextWithRetry(url, { signal });
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch (_) {
        payload = null;
      }

      if (!payload || !payload.data || !Array.isArray(payload.data.children)) {
        break;
      }

      const parsed = parseItemsFromSearchJson(payload);
      pagesFetched += 1;

      parsed.items.forEach((item) => {
        const key = String(item && item.rabKey ? item.rabKey : '');
        if (!key || seenKeys.has(key)) {
          return;
        }
        seenKeys.add(key);
        if (item && item.data && item.data.subreddit) {
          seenSubreddits.add(String(item.data.subreddit).toLowerCase());
        }
        allItems.push(item);
      });

      const hasEnoughVolume = allItems.length >= C.SEARCH.MIN_ITEMS_TO_STOP;
      const hasEnoughDiversity = seenSubreddits.size >= C.DATA_WINDOW.TOP_BADGES;
      if (hasEnoughVolume && hasEnoughDiversity) {
        break;
      }

      if (!parsed.after) {
        break;
      }

      after = parsed.after;
    }

    return {
      items: allItems,
      pagesFetched,
      uniqueSubreddits: seenSubreddits.size
    };
  }

  async function fetchRecentItemsForUser(username, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const signal = options.signal || null;
    const postsOnly = Boolean(options.postsOnly);

    if (postsOnly) {
      const posts = await crawlSearchJsonPosts(username, { signal });
      return {
        items: posts.items,
        pagesFetched: posts.pagesFetched,
        userMatchCount: 0,
        counts: {
          comments: 0,
          posts: posts.items.length
        },
        pagesByType: {
          comments: 0,
          posts: posts.pagesFetched
        },
        uniqueSubredditsByType: {
          comments: 0,
          posts: posts.uniqueSubreddits || 0
        }
      };
    }

    const comments = await crawlType(username, C.SEARCH.TYPE_OPTIONS.COMMENTS, { signal, trackUserMatches: true });
    const posts = await crawlType(username, C.SEARCH.TYPE_OPTIONS.POSTS, { signal, trackUserMatches: true });

    return {
      items: comments.items.concat(posts.items),
      pagesFetched: comments.pagesFetched + posts.pagesFetched,
      userMatchCount: (comments.userMatchCount || 0) + (posts.userMatchCount || 0),
      counts: {
        comments: comments.items.length,
        posts: posts.items.length
      },
      pagesByType: {
        comments: comments.pagesFetched,
        posts: posts.pagesFetched
      },
      uniqueSubredditsByType: {
        comments: comments.uniqueSubreddits || 0,
        posts: posts.uniqueSubreddits || 0
      }
    };
  }

  root.searchSource = {
    fetchRecentItemsForUser
  };
})(globalThis);

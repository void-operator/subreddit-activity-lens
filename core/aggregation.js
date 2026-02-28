(function initAggregation(global) {
  const root = global.RAB || (global.RAB = {});
  const C = root.constants;
  const U = root.utils;

  function createEmptySubredditStats() {
    return {
      comments: 0,
      posts: 0,
      totalRaw: 0,
      score: 0
    };
  }

  function upsertSubredditStats(map, subreddit, kind) {
    const key = String(subreddit || '').trim();
    if (!key) {
      return;
    }

    const current = map.get(key) || createEmptySubredditStats();

    if (kind === 't1') {
      current.comments += 1;
    } else if (kind === 't3') {
      current.posts += 1;
    } else {
      return;
    }

    current.totalRaw = current.comments + current.posts;
    current.score = current.comments + (C.SCORING.POST_WEIGHT * current.posts);
    map.set(key, current);
  }

  function projectTopSubreddits(subredditMap) {
    return rankSubreddits(subredditMap)
      .slice(0, C.DATA_WINDOW.TOP_BADGES);
  }

  function rankSubreddits(subredditMap) {
    return Array.from(subredditMap.entries())
      .map(([subreddit, stats]) => ({
        subreddit,
        comments: stats.comments,
        posts: stats.posts,
        totalRaw: stats.totalRaw,
        score: stats.score
      }))
      .sort((a, b) => b.score - a.score || b.totalRaw - a.totalRaw || a.subreddit.localeCompare(b.subreddit))
      ;
  }

  function computeConfidence(state, previousTopSubreddits) {
    const nowSec = U.nowMs() / C.TIME.SECOND_MS;
    const windowSec = C.DATA_WINDOW.WINDOW_DAYS * C.TIME.DAY_MS / C.TIME.SECOND_MS;
    const cutoffSec = nowSec - windowSec;

    let timeCoverage = 0;
    if (Number.isFinite(state.oldestIncludedUtcSec)) {
      const coveredSec = nowSec - state.oldestIncludedUtcSec;
      timeCoverage = U.clamp(coveredSec / windowSec, 0, 1);
    } else if (state.oldestSeenUtcSec <= cutoffSec) {
      timeCoverage = 1;
    }

    const volume = U.clamp(state.inWindowItemsCount / C.SCORING.VOLUME_TARGET_ITEMS, 0, 1);

    const currentTopSubreddits = projectTopSubreddits(state.subredditStats)
      .map((item) => item.subreddit);

    let stability = 0;
    if (previousTopSubreddits === null) {
      stability = state.pagesFetched > 1 ? 0.5 : 0;
    } else {
      stability = U.jaccardIndex(previousTopSubreddits, currentTopSubreddits);
    }

    const weighted = (
      (C.SCORING.CONFIDENCE_WEIGHTS.TIME_COVERAGE * timeCoverage) +
      (C.SCORING.CONFIDENCE_WEIGHTS.VOLUME * volume) +
      (C.SCORING.CONFIDENCE_WEIGHTS.STABILITY * stability)
    );

    return {
      score: U.clamp(weighted, 0, 1),
      timeCoverage,
      volume,
      stability,
      topSubreddits: currentTopSubreddits
    };
  }

  function createAggregationState() {
    return {
      subredditStats: new Map(),
      seenItemKeys: new Set(),
      pagesFetched: 0,
      itemsProcessed: 0,
      inWindowItemsCount: 0,
      commentItemsCount: 0,
      postItemsCount: 0,
      newestSeenUtcSec: Number.NEGATIVE_INFINITY,
      oldestSeenUtcSec: Number.POSITIVE_INFINITY,
      oldestIncludedUtcSec: Number.POSITIVE_INFINITY
    };
  }

  function buildItemKey(kind, data) {
    if (!data || typeof data !== 'object') {
      return null;
    }

    if (typeof data.name === 'string' && data.name.length > 0) {
      return `${kind}:${data.name}`;
    }

    if (typeof data.id === 'string' && data.id.length > 0) {
      return `${kind}:id:${data.id}`;
    }

    if (typeof data.permalink === 'string' && data.permalink.length > 0) {
      return `${kind}:permalink:${data.permalink}`;
    }

    return null;
  }

  function processPage(state, children) {
    const nowSec = U.nowMs() / C.TIME.SECOND_MS;
    const cutoffSec = nowSec - ((C.DATA_WINDOW.WINDOW_DAYS * C.TIME.DAY_MS) / C.TIME.SECOND_MS);

    children.forEach((item) => {
      if (!item || typeof item !== 'object') {
        return;
      }

      const kind = item.kind;
      const data = item.data || {};
      const createdUtcSec = Number(data.created_utc);
      const subreddit = data.subreddit;

      state.itemsProcessed += 1;

      const itemKey = buildItemKey(kind, data);
      if (itemKey) {
        if (state.seenItemKeys.has(itemKey)) {
          return;
        }
        state.seenItemKeys.add(itemKey);
      }

      if (!Number.isFinite(createdUtcSec)) {
        return;
      }

      if (createdUtcSec > state.newestSeenUtcSec) {
        state.newestSeenUtcSec = createdUtcSec;
      }
      if (createdUtcSec < state.oldestSeenUtcSec) {
        state.oldestSeenUtcSec = createdUtcSec;
      }

      if (createdUtcSec < cutoffSec) {
        return;
      }

      if (createdUtcSec < state.oldestIncludedUtcSec) {
        state.oldestIncludedUtcSec = createdUtcSec;
      }

      if (kind === 't1') {
        state.commentItemsCount += 1;
      } else if (kind === 't3') {
        state.postItemsCount += 1;
      } else {
        return;
      }

      state.inWindowItemsCount += 1;
      upsertSubredditStats(state.subredditStats, subreddit, kind);
    });
  }

  function shouldStopPaging(state, confidence, hasAfter) {
    const nowSec = U.nowMs() / C.TIME.SECOND_MS;
    const cutoffSec = nowSec - ((C.DATA_WINDOW.WINDOW_DAYS * C.TIME.DAY_MS) / C.TIME.SECOND_MS);

    const reachedWindowBoundary = Number.isFinite(state.oldestSeenUtcSec)
      && state.oldestSeenUtcSec <= cutoffSec;

    const reachedMaxPages = state.pagesFetched >= C.FETCH.MAX_PAGES_PER_USER;
    const reachedConfidence = (
      state.pagesFetched >= C.DATA_WINDOW.MIN_PAGES_FOR_CONFIDENCE_STOP
      && confidence.score >= C.SCORING.CONFIDENCE_THRESHOLD
    );

    return reachedWindowBoundary || reachedMaxPages || reachedConfidence || !hasAfter;
  }

  function finalizeResult(username, state, confidence) {
    const rankedAll = rankSubreddits(state.subredditStats);
    const ranked = rankedAll.slice(0, C.DATA_WINDOW.TOP_BADGES_MAX);
    const top = ranked.slice(0, C.DATA_WINDOW.TOP_BADGES);

    return {
      username,
      generatedAtMs: U.nowMs(),
      windowDays: C.DATA_WINDOW.WINDOW_DAYS,
      topSubreddits: top,
      rankedSubreddits: ranked,
      confidence,
      flags: {
        noListingData: state.itemsProcessed === 0
      },
      stats: {
        pagesFetched: state.pagesFetched,
        itemsProcessed: state.itemsProcessed,
        inWindowItemsCount: state.inWindowItemsCount,
        commentItemsCount: state.commentItemsCount,
        postItemsCount: state.postItemsCount,
        newestSeenUtcSec: Number.isFinite(state.newestSeenUtcSec) ? state.newestSeenUtcSec : null,
        oldestSeenUtcSec: Number.isFinite(state.oldestSeenUtcSec) ? state.oldestSeenUtcSec : null,
        oldestIncludedUtcSec: Number.isFinite(state.oldestIncludedUtcSec) ? state.oldestIncludedUtcSec : null
      }
    };
  }

  root.aggregation = {
    createAggregationState,
    processPage,
    computeConfidence,
    shouldStopPaging,
    finalizeResult
  };
})(globalThis);

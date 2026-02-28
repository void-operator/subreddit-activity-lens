(function initConstants(global) {
  const root = global.RAB || (global.RAB = {});

  const CONSTANTS = Object.freeze({
    DATA_WINDOW: Object.freeze({
      WINDOW_DAYS: 30,
      TOP_BADGES: 5,
      TOP_BADGES_MAX: 20,
      MIN_PAGES_FOR_CONFIDENCE_STOP: 1
    }),

    SCORING: Object.freeze({
      POST_WEIGHT: 2,
      CONFIDENCE_THRESHOLD: 0.60,
      CONFIDENCE_WEIGHTS: Object.freeze({
        TIME_COVERAGE: 0.45,
        VOLUME: 0.25,
        STABILITY: 0.30
      }),
      VOLUME_TARGET_ITEMS: 80
    }),

    FETCH: Object.freeze({
      SOURCE_PATH_TEMPLATE: '/user/{username}/overview.json',
      LIMIT_PER_PAGE: 100,
      MAX_PAGES_PER_USER: 3,
      MAX_CONCURRENT_REQUESTS: 2,
      REQUEST_SPACING_MS: 750,
      RETRY_ATTEMPTS: 2,
      RETRY_BACKOFF_MS: 500,
      HTTP_429_BACKOFF_MS: 3000,
      HTTP_403_COOLDOWN_MS: 30000,
      HEADER_RETRY_AFTER: 'retry-after'
    }),

    RATE_LIMIT: Object.freeze({
      USER_STARTS_PER_MINUTE: 20,
      GLOBAL_429_COOLDOWN_MS: 60000
    }),

    SEARCH: Object.freeze({
      USER_SEARCH_PATH_TEMPLATE: '/user/{username}/search/',
      SVC_USER_SEARCH_PATH_TEMPLATE: '/svc/shreddit/user/{username}/search/',
      QUERY_VALUE: ' ',
      SORT: 'new',
      TIME_RANGE: 'month',
      TYPE_OPTIONS: Object.freeze({
        COMMENTS: 'comments',
        POSTS: 'posts'
      }),
      // Safety cap. Actual paging may stop earlier once we have enough diversity and volume.
      MAX_PAGES_PER_TYPE: 6,
      MIN_ITEMS_TO_STOP: 80,
      RESULT_LINK_PATTERN: '^/r/([^/]+)/comments/([^/]+)/([^/?#]+)(?:/([^/?#]+))?/?$',
      NEXT_PARTIAL_SELECTOR: 'faceplate-partial[src*="/svc/shreddit/user/"][src*="/search/"][src*="cursor="]',
      TIMEAGO_SELECTOR: 'faceplate-timeago[ts], time[datetime]',
      MAX_TIME_LOOKUP_HOPS: 6
    }),

    REFINE: Object.freeze({
      // If A1 returns fewer than 5 unique subreddits, treat it as potentially facade/partial.
      SUSPECT_TOP_SUBREDDITS_MAX: 4,
      BACKGROUND_START_DELAY_MS: 1200
    }),

    CACHE: Object.freeze({
      TTL_MS: 12 * 60 * 60 * 1000,
      EMPTY_TTL_MS: 15 * 60 * 1000,
      TRANSIENT_EMPTY_TTL_MS: 5 * 60 * 1000,
      STORAGE_PREFIX: 'rab:cache:v3:',
      SOURCE_HINT_PREFIX: 'rab:source:v1:',
      SOURCE_HINT_TTL_MS: 12 * 60 * 60 * 1000,
      MEMORY_MAX_USERS: 300
    }),

    LOGGING: Object.freeze({
      LEVEL: 'error',
      TIMING_ENABLED: true,
      TIMING_CONSOLE_ENABLED: false,
      DEBUG_CAPTURE_ENABLED: true,
      STORAGE_KEY: 'rab:hardFailureLogs:v1',
      MAX_ERROR_LOG_ENTRIES: 200,
      CONSOLE_USER_STATUS_ONCE: true
    }),

    UI: Object.freeze({
      BADGE_MODE_DEFAULT: 'detailed',
      BADGE_MODE_OPTIONS: Object.freeze({
        DETAILED: 'detailed',
        COMPACT: 'compact'
      }),
      SHOW_MORE_STEP: 2,
      ROOT_CLASS: 'rab-badge-root',
      ROW_CLASS: 'rab-badge-row',
      BADGE_CLASS: 'rab-badge-chip',
      STATE_CLASS: 'rab-state',
      MOUNT_ATTR: 'data-rab-mounted-user',
      BADGE_MAX_SUBREDDIT_LENGTH: 24
    }),

    IGNORE: Object.freeze({
      USERNAMES: Object.freeze(['automoderator']),
      // Used to detect the right-sidebar "Moderators" widget on post pages.
      // (We treat those users as manual-only to avoid burst auto-scans.)
      MODERATORS_LINK_SELECTOR: 'a[href*="/about/moderators"], a[href^="/mod/"][href*="/moderators/"], a[href*="/message/compose?to=r/"]',
      MODERATORS_MAX_ANCESTOR_HOPS: 8
    }),

    SELECTORS: Object.freeze({
      USER_ANCHOR: 'a[href^="/user/"], a[href*="reddit.com/user/"]',
      COMMENT_CONTAINER_HINT: 'shreddit-comment, [thingid^="t1_"], [data-testid*="comment"]'
    }),

    OBSERVATION: Object.freeze({
      VIEWPORT_ROOT_MARGIN: '24px 0px',
      VIEWPORT_THRESHOLD: 0.01,
      MUTATION_SCAN_DEBOUNCE_MS: 160,
      READY_STATE_SCAN_DELAY_MS: 100,
      POPSTATE_SCAN_DELAY_MS: 140,
      URL_CHANGE_SCAN_DELAY_MS: 180,
      URL_POLL_INTERVAL_MS: 1200
    }),

    STORAGE_KEYS: Object.freeze({
      ERROR_LOGS: 'rab:hardFailureLogs:v1',
      OPTIONS: 'rab:options:v1',
      ACTIVITY_BASE: 'rab:activity:view:v1:'
    }),

    TIME: Object.freeze({
      SECOND_MS: 1000,
      MINUTE_MS: 60 * 1000,
      HOUR_MS: 60 * 60 * 1000,
      DAY_MS: 24 * 60 * 60 * 1000
    })
  });

  root.constants = CONSTANTS;
})(globalThis);

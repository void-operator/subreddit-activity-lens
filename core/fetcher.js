(function initFetcher(global) {
  const root = global.RAB || (global.RAB = {});
  const C = root.constants;
  const U = root.utils;
  const logger = root.logger;

  function createAbortError() {
    try {
      return new DOMException('Aborted', 'AbortError');
    } catch (_) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return err;
    }
  }

  function emitRateLimit(payload) {
    try {
      if (root.events && typeof root.events.emit === 'function') {
        root.events.emit('rateLimit', payload);
      }
    } catch (_) {
      // ignore
    }
  }

  class HttpError extends Error {
    constructor(message, details) {
      super(message);
      this.name = 'HttpError';
      this.details = details || {};
    }
  }

  class TaskQueue {
    constructor(maxConcurrent, spacingMs) {
      this.maxConcurrent = maxConcurrent;
      this.spacingMs = spacingMs;
      this.running = 0;
      this.pending = [];
      this.lastRunMs = 0;
      this.cooldownUntilMs = 0;
    }

    getCooldownUntilMs() {
      return this.cooldownUntilMs || 0;
    }

    enqueue(taskFn, opts) {
      const options = opts && typeof opts === 'object' ? opts : {};
      const signal = options.signal || null;
      return new Promise((resolve, reject) => {
        this.pending.push({ taskFn, resolve, reject, signal });
        this.pump();
      });
    }

    noteCooldown(untilMs) {
      if (!Number.isFinite(untilMs)) {
        return;
      }
      if (untilMs <= this.cooldownUntilMs) {
        return;
      }
      this.cooldownUntilMs = untilMs;
      this.pump();
    }

    pump() {
      const nowMs = U.nowMs();
      if (this.cooldownUntilMs && nowMs < this.cooldownUntilMs) {
        setTimeout(() => this.pump(), Math.max(50, this.cooldownUntilMs - nowMs));
        return;
      }

      while (this.running < this.maxConcurrent && this.pending.length > 0) {
        const elapsed = U.nowMs() - this.lastRunMs;
        if (elapsed < this.spacingMs) {
          setTimeout(() => this.pump(), this.spacingMs - elapsed);
          return;
        }

        const item = this.pending.shift();
        if (!item) {
          return;
        }

        if (item.signal && item.signal.aborted) {
          item.reject(createAbortError());
          continue;
        }

        this.running += 1;
        this.lastRunMs = U.nowMs();

        Promise.resolve()
          .then(() => item.taskFn())
          .then((result) => item.resolve(result))
          .catch((error) => item.reject(error))
          .finally(() => {
            this.running -= 1;
            this.pump();
          });
      }
    }
  }

  const sharedQueue = new TaskQueue(
    C.FETCH.MAX_CONCURRENT_REQUESTS,
    C.FETCH.REQUEST_SPACING_MS
  );

  async function fetchListingPage(pathTemplate, username, after, signal) {
    const url = U.buildListingUrl(pathTemplate, username, after);
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      signal,
      headers: {
        Accept: 'application/json,text/plain,*/*'
      }
    });

    if (!response.ok) {
      throw new HttpError('non-OK response from overview endpoint', {
        status: response.status,
        statusText: response.statusText,
        retryAfterMs: U.parseRetryAfterMs(response.headers),
        url,
        username,
        after
      });
    }

    const payload = await response.json();
    const data = payload && payload.data;
    const children = data && Array.isArray(data.children) ? data.children : null;

    if (!children) {
      throw new HttpError('unexpected overview response schema', {
        status: response.status,
        username,
        url
      });
    }

    return {
      children,
      after: data.after || null,
      before: data.before || null,
      dist: Number.isFinite(data.dist) ? data.dist : children.length,
      url
    };
  }

  async function fetchTextPage(url, signal) {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      throw new HttpError('non-OK response from text endpoint', {
        status: response.status,
        statusText: response.statusText,
        retryAfterMs: U.parseRetryAfterMs(response.headers),
        url
      });
    }

    return response.text();
  }

  async function fetchPageWithRetry(username, after, pathTemplate, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const signal = options.signal || null;
    let attempt = 0;
    let lastError = null;
    const template = pathTemplate || C.FETCH.SOURCE_PATH_TEMPLATE;

    while (attempt <= C.FETCH.RETRY_ATTEMPTS) {
      if (signal && signal.aborted) {
        throw createAbortError();
      }
      try {
        const context = `u=${username} path=${template} after=${after || '-'} attempt=${attempt + 1}`;
        const queueAtMs = U.nowMs();
        logger.timing(`listing queued ${context}`);
        const result = await sharedQueue.enqueue(async () => {
          if (signal && signal.aborted) {
            throw createAbortError();
          }
          const startMs = U.nowMs();
          logger.timing(`listing start ${context} wait=${startMs - queueAtMs}ms`);
          const page = await fetchListingPage(template, username, after, signal);
          logger.timing(`listing done ${context} dur=${U.nowMs() - startMs}ms items=${page.children.length}`);
          return page;
        }, { signal });
        return result;
      } catch (error) {
        lastError = error;
        const details = error && error.details ? error.details : {};
        const status = details.status;
        if (error && error.name === 'AbortError') {
          throw error;
        }
        logger.timing(
          `listing fail u=${username} path=${template} after=${after || '-'} attempt=${attempt + 1} status=${status || 'n/a'}`
        );

        if (status === 403) {
          await U.sleep(C.FETCH.HTTP_403_COOLDOWN_MS);
          break;
        }

        if (status === 429) {
          const retryAfterMs = Number.isFinite(details.retryAfterMs)
            ? details.retryAfterMs
            : C.FETCH.HTTP_429_BACKOFF_MS;
          const untilMs = U.nowMs() + Math.max(retryAfterMs, C.RATE_LIMIT.GLOBAL_429_COOLDOWN_MS);
          sharedQueue.noteCooldown(untilMs);
          emitRateLimit({
            status: 429,
            untilMs,
            retryAfterMs,
            kind: 'listing',
            url: details.url || null,
            username
          });
          await U.sleep(Math.max(retryAfterMs, C.FETCH.HTTP_429_BACKOFF_MS));
          attempt += 1;
          continue;
        }

        if (attempt >= C.FETCH.RETRY_ATTEMPTS) {
          break;
        }

        const backoffMs = C.FETCH.RETRY_BACKOFF_MS * Math.pow(2, attempt);
        await U.sleep(backoffMs);
        attempt += 1;
      }
    }

    if (lastError) {
      logger.error('overview fetch failed after retry', {
        username,
        after,
        error: lastError
      });
    }

    throw lastError || new Error('unknown fetch failure');
  }

  async function fetchTextWithRetry(url, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const signal = options.signal || null;
    let attempt = 0;
    let lastError = null;

    while (attempt <= C.FETCH.RETRY_ATTEMPTS) {
      if (signal && signal.aborted) {
        throw createAbortError();
      }
      try {
        const context = summarizeSearchUrl(url, attempt + 1);
        const queueAtMs = U.nowMs();
        logger.timing(`search queued ${context}`);
        const result = await sharedQueue.enqueue(async () => {
          if (signal && signal.aborted) {
            throw createAbortError();
          }
          const startMs = U.nowMs();
          logger.timing(`search start ${context} wait=${startMs - queueAtMs}ms`);
          const text = await fetchTextPage(url, signal);
          logger.timing(`search done ${context} dur=${U.nowMs() - startMs}ms bytes=${text.length}`);
          return text;
        }, { signal });
        return result;
      } catch (error) {
        lastError = error;
        const details = error && error.details ? error.details : {};
        const status = details.status;
        if (error && error.name === 'AbortError') {
          throw error;
        }
        logger.timing(`search fail ${summarizeSearchUrl(url, attempt + 1)} status=${status || 'n/a'}`);

        if (status === 403) {
          await U.sleep(C.FETCH.HTTP_403_COOLDOWN_MS);
          break;
        }

        if (status === 429) {
          const retryAfterMs = Number.isFinite(details.retryAfterMs)
            ? details.retryAfterMs
            : C.FETCH.HTTP_429_BACKOFF_MS;
          const untilMs = U.nowMs() + Math.max(retryAfterMs, C.RATE_LIMIT.GLOBAL_429_COOLDOWN_MS);
          sharedQueue.noteCooldown(untilMs);
          emitRateLimit({
            status: 429,
            untilMs,
            retryAfterMs,
            kind: 'search',
            url,
            username: (() => {
              try {
                return extractUserFromPath(new URL(url, global.location.origin).pathname);
              } catch (_) {
                return 'n/a';
              }
            })()
          });
          await U.sleep(Math.max(retryAfterMs, C.FETCH.HTTP_429_BACKOFF_MS));
          attempt += 1;
          continue;
        }

        if (attempt >= C.FETCH.RETRY_ATTEMPTS) {
          break;
        }

        const backoffMs = C.FETCH.RETRY_BACKOFF_MS * Math.pow(2, attempt);
        await U.sleep(backoffMs);
        attempt += 1;
      }
    }

    if (lastError) {
      logger.error('text fetch failed after retry', {
        url,
        error: lastError
      });
    }

    throw lastError || new Error('unknown text fetch failure');
  }

  function summarizeSearchUrl(rawUrl, attemptNumber) {
    try {
      const url = new URL(rawUrl, global.location.origin);
      const type = url.searchParams.get('type') || 'n/a';
      const hasCursor = url.searchParams.has('cursor');
      const t = url.searchParams.get('t') || 'n/a';
      return `u=${extractUserFromPath(url.pathname)} type=${type} cursor=${hasCursor ? 'y' : 'n'} t=${t} attempt=${attemptNumber}`;
    } catch (_) {
      return `url=unparseable attempt=${attemptNumber}`;
    }
  }

  function extractUserFromPath(pathname) {
    const match = String(pathname || '').match(/\/user\/([^/]+)\//i);
    return match ? match[1].toLowerCase() : 'n/a';
  }

  root.fetcher = {
    HttpError,
    fetchPageWithRetry,
    fetchTextWithRetry,
    getGlobalCooldownUntilMs: () => sharedQueue.getCooldownUntilMs()
  };
})(globalThis);

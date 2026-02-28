(function initActivityView() {
  const C = (globalThis.RAB && globalThis.RAB.constants) || {};

  function $(id) {
    return document.getElementById(id);
  }

  function buildStorageKey(id) {
    const base = C.STORAGE_KEYS && C.STORAGE_KEYS.ACTIVITY_BASE
      ? C.STORAGE_KEYS.ACTIVITY_BASE
      : 'rab:activity:view:v1:';
    return `${base}${id}`;
  }

  function getIdFromLocation() {
    try {
      const url = new URL(globalThis.location.href);
      return url.searchParams.get('id') || '';
    } catch (_) {
      return '';
    }
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec)) {
      return '';
    }
    try {
      return new Date(sec * 1000).toLocaleString();
    } catch (_) {
      return '';
    }
  }

  async function loadPayload() {
    const id = getIdFromLocation();
    if (!id || !globalThis.chrome || !globalThis.chrome.storage) {
      return null;
    }
    const key = buildStorageKey(id);
    return new Promise((resolve) => {
      globalThis.chrome.storage.local.get([key], (result) => {
        resolve(result && result[key] ? result[key] : null);
      });
    });
  }

  function renderPosts(listNode, posts) {
    if (!listNode) {
      return;
    }
    listNode.innerHTML = '';
    const rows = Array.isArray(posts) ? posts : [];
    rows.forEach((post) => {
      if (!post || !post.permalink || !post.subreddit) {
        return;
      }
      const item = document.createElement('div');
      item.className = 'item';

      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = post.title || '(post)';

      const meta = document.createElement('div');
      meta.className = 'item-meta';

      const sub = document.createElement('span');
      sub.textContent = `r/${post.subreddit}`;

      const time = document.createElement('span');
      time.textContent = formatTime(post.createdUtcSec);

      const link = document.createElement('a');
      link.href = `https://www.reddit.com${post.permalink}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open post';

      meta.appendChild(sub);
      if (time.textContent) {
        meta.appendChild(time);
      }
      meta.appendChild(link);

      item.appendChild(title);
      item.appendChild(meta);
      listNode.appendChild(item);
    });
  }

  async function main() {
    const payload = await loadPayload();
    const title = $('title');
    const empty = $('empty');
    const posts = $('posts');

    if (!payload) {
      if (title) {
        title.textContent = 'u/–';
      }
      if (empty) {
        empty.style.display = 'block';
      }
      return;
    }

    if (title) {
      title.textContent = `u/${payload.username || '–'}`;
    }

    renderPosts(posts, payload.posts || []);

    if (!payload.posts || payload.posts.length === 0) {
      if (empty) {
        empty.style.display = 'block';
      }
    }
  }

  main();
})();

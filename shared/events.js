(function initEvents(global) {
  const root = global.RAB || (global.RAB = {});

  const listeners = new Map();

  function on(type, handler) {
    const t = String(type || '');
    if (!t || typeof handler !== 'function') {
      return () => {};
    }
    let set = listeners.get(t);
    if (!set) {
      set = new Set();
      listeners.set(t, set);
    }
    set.add(handler);

    return () => {
      set.delete(handler);
      if (set.size === 0) {
        listeners.delete(t);
      }
    };
  }

  function emit(type, payload) {
    const t = String(type || '');
    const set = listeners.get(t);
    if (!set || set.size === 0) {
      return;
    }
    set.forEach((handler) => {
      try {
        handler(payload);
      } catch (_) {
        // Ignore handler failures.
      }
    });
  }

  root.events = { on, emit };
})(globalThis);


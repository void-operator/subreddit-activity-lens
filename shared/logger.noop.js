(function initNoopLogger(global) {
  const root = global.RAB || (global.RAB = {});

  function noop() {}

  root.logger = {
    error: noop,
    info: noop,
    timing: noop,
    statusOncePerUser: noop,
    appendHardFailure: async () => {}
  };
})(globalThis);


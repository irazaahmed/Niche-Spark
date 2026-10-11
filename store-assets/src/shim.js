// Screenshot harness only (never shipped): stands in for the chrome.* APIs so
// the built extension pages (dist/) can render on localhost in headless Chrome.
(() => {
  const KEY = '__ns_shim_store';
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      return {};
    }
  };
  const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));
  window.chrome = Object.assign(window.chrome || {}, {
    runtime: {
      id: 'screenshot-harness',
      getManifest: () => ({ version: '0.2.0' }),
      getURL: (p) => '/' + p,
      sendMessage: async (msg) => (msg?.type === 'job/get' ? { ok: true, job: load()['nichespark.job'] ?? null } : { ok: true, job: null }),
    },
    storage: {
      local: {
        get: async (k) => {
          const s = load();
          return typeof k === 'string' ? { [k]: s[k] } : s;
        },
        set: async (o) => save({ ...load(), ...o }),
        remove: async (k) => {
          const s = load();
          delete s[k];
          save(s);
        },
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
    tabs: { create: async () => ({}), update: async () => ({}) },
    windows: { update: async () => ({}) },
  });
})();

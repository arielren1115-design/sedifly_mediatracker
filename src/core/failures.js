// Failed classifier runs per message, kept as a small JSON map in a Script Property (BUILD_SPEC 9.3: three failed runs, then review).

const KEEP_MS = 3 * 24 * 3600 * 1000;
const KEEP_MAX = 200;

/**
 * @param {{read: () => string|null, write: (text: string) => void, now: () => number}} store
 * @returns {{count: (id: string) => number, add: (id: string) => number, clear: (id: string) => void}}
 */
export function createFailureCounter(store) {
  const load = () => {
    try {
      const m = JSON.parse(store.read() || '{}');
      return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
    } catch (e) {
      return {};
    }
  };
  const save = (m) => {
    const cutoff = store.now() - KEEP_MS;
    const live = Object.entries(m).filter(([, v]) => v && v.at >= cutoff).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP_MAX);
    store.write(JSON.stringify(Object.fromEntries(live)));
  };
  return {
    count: (id) => (load()[id] || { n: 0 }).n,
    add(id) {
      const m = load();
      const n = ((m[id] || { n: 0 }).n || 0) + 1;
      m[id] = { n, at: store.now() };
      save(m);
      return n;
    },
    clear(id) {
      const m = load();
      if (id in m) { delete m[id]; save(m); }
    },
  };
}

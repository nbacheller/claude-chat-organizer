// Persistent state: activity cache, settings backups (20), undo batches (10), flags.
// `area` is chrome.storage.local or anything with the same async get/set.
import { capList } from './util.js';

export const MAX_BACKUPS = 20;
export const MAX_BATCHES = 10;

export function createStorage(area) {
  const get = async (key, fallback) => {
    const r = await area.get(key);
    return r[key] ?? fallback;
  };
  const set = (key, value) => area.set({ [key]: value });
  return {
    getCache: () => get('activityCache', {}),
    setCache: cache => set('activityCache', cache),
    getBackups: () => get('backups', []),
    async pushBackup(record) {
      const entry = { at: new Date().toISOString(), record };
      await set('backups', capList(await get('backups', []), entry, MAX_BACKUPS));
      return entry;
    },
    getBatches: () => get('batches', []),
    async pushBatch(batch) {
      await set('batches', capList(await get('batches', []), batch, MAX_BATCHES));
    },
    async popBatch() {
      const [first, ...rest] = await get('batches', []);
      await set('batches', rest);
      return first || null;
    },
    getFlag: name => get(`flag:${name}`, false),
    setFlag: (name, value) => set(`flag:${name}`, value),
  };
}

// localStorage-backed area for mock mode outside the extension.
export const localArea = {
  async get(key) {
    const raw = localStorage.getItem(`cco:${key}`);
    return raw === null ? {} : { [key]: JSON.parse(raw) };
  },
  async set(obj) {
    for (const [k, v] of Object.entries(obj)) localStorage.setItem(`cco:${k}`, JSON.stringify(v));
  },
};

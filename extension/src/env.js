// Real extension (chrome.scripting present) or mock mode (?mock=1, dev server).
// Every api call waits and retries when claude.ai rate-limits; set api.onWait to show it.
import { createStorage, localArea } from './storage.js';
import { withRetry } from './retry.js';

export const isMock = new URLSearchParams(location.search).has('mock')
  || !(globalThis.chrome && chrome.scripting);

function retrying(api) {
  const wrapped = { onWait: null };
  for (const [name, fn] of Object.entries(api)) {
    if (typeof fn !== 'function') continue;
    wrapped[name] = (...args) => withRetry(() => fn(...args), {
      onWait: (ms, attempt) => wrapped.onWait && wrapped.onWait(ms, attempt),
    });
  }
  return wrapped;
}

export async function loadEnv() {
  if (isMock) {
    const { mockApi } = await import('../dev/mock-api.js');
    return { api: retrying(mockApi), storage: createStorage(localArea), isMock };
  }
  const { api } = await import('./api.js');
  return { api: retrying(api), storage: createStorage(chrome.storage.local), isMock };
}

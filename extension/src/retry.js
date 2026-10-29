// Wait-and-retry when claude.ai says to slow down (429) or is briefly unavailable (503).
import { sleep as realSleep } from './util.js';

const RETRYABLE = new Set([429, 503]);
const MAX_WAIT_MS = 60000;

export async function withRetry(fn, { retries = 5, baseMs = 2000, sleep = realSleep, onWait } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!RETRYABLE.has(err && err.status) || attempt > retries) throw err;
      const asked = Number(err.retryAfter) * 1000;
      const ms = Math.min(asked > 0 ? asked : baseMs * 2 ** (attempt - 1), MAX_WAIT_MS);
      if (onWait) onWait(ms, attempt);
      await sleep(ms);
    }
  }
}

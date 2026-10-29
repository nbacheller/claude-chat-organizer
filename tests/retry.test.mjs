import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../extension/src/retry.js';

const limited = (retryAfter) => Object.assign(new Error('Rename failed (429)'), { status: 429, retryAfter });

test('retries on 429 then succeeds', async () => {
  const waits = [];
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls < 3) throw limited();
    return 'ok';
  }, { sleep: async ms => waits.push(ms) });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 4000]);
});

test('honors Retry-After seconds', async () => {
  const waits = [];
  let calls = 0;
  await withRetry(async () => {
    if (calls++ === 0) throw limited('7');
    return 'ok';
  }, { sleep: async ms => waits.push(ms) });
  assert.deepEqual(waits, [7000]);
});

test('gives up after max retries', async () => {
  const waits = [];
  await assert.rejects(
    withRetry(async () => { throw limited(); }, { retries: 3, sleep: async ms => waits.push(ms) }),
    err => err.status === 429,
  );
  assert.deepEqual(waits, [2000, 4000, 8000]);
});

test('does not retry other errors', async () => {
  const waits = [];
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw Object.assign(new Error('nope'), { status: 400 }); }, { sleep: async ms => waits.push(ms) }),
    /nope/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

test('retries 503 too and reports each wait', async () => {
  const seen = [];
  let calls = 0;
  await withRetry(async () => {
    if (calls++ === 0) throw Object.assign(new Error('busy'), { status: 503 });
    return 'ok';
  }, { sleep: async () => {}, onWait: (ms, attempt) => seen.push([ms, attempt]) });
  assert.deepEqual(seen, [[2000, 1]]);
});

test('caps the wait', async () => {
  const waits = [];
  let calls = 0;
  await withRetry(async () => {
    if (calls++ === 0) throw limited('600');
    return 'ok';
  }, { sleep: async ms => waits.push(ms) });
  assert.deepEqual(waits, [60000]);
});

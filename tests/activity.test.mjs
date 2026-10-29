import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastMessageAt, resolveLastUsed } from '../extension/src/activity.js';

const chat = { uuid: 'c1', updated_at: '2026-10-29T15:00:48.711Z' };

test('cache hit skips fetch', async () => {
  let calls = 0;
  const cache = { c1: { updated_at: chat.updated_at, lastUsed: '2026-10-29T15:00:48.856Z' } };
  const r = await resolveLastUsed(chat, cache, async () => { calls++; return 'x'; });
  assert.deepEqual(r, { at: '2026-10-29T15:00:48.856Z', approx: false });
  assert.equal(calls, 0);
});

test('cache miss fetches and stores', async () => {
  const cache = { c1: { updated_at: 'older', lastUsed: '2026-01-01T00:00:00Z' } };
  const r = await resolveLastUsed(chat, cache, async uuid => (uuid === 'c1' ? '2026-10-29T15:00:48.856Z' : null));
  assert.deepEqual(r, { at: '2026-10-29T15:00:48.856Z', approx: false });
  assert.deepEqual(cache.c1, { updated_at: chat.updated_at, lastUsed: '2026-10-29T15:00:48.856Z' });
});

test('fetch failure is approximate and uncached', async () => {
  const cache = {};
  const r1 = await resolveLastUsed(chat, cache, async () => { throw new Error('boom'); });
  assert.deepEqual(r1, { at: chat.updated_at, approx: true });
  const r2 = await resolveLastUsed(chat, cache, async () => null);
  assert.deepEqual(r2, { at: chat.updated_at, approx: true });
  assert.deepEqual(cache, {});
});

test('lastMessageAt picks newest', () => {
  const conv = { chat_messages: [
    { created_at: '2026-09-10T21:15:15Z' },
    { created_at: '2026-10-29T15:00:48Z' },
    { created_at: '2026-10-01T09:00:00Z' },
  ] };
  assert.equal(lastMessageAt(conv), '2026-10-29T15:00:48Z');
  assert.equal(lastMessageAt({ chat_messages: [] }), null);
  assert.equal(lastMessageAt({}), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capList, chunk, groupColor, mapLimit, menuTargets, TINT_COUNT } from '../extension/src/util.js';

test('menuTargets uses the selection only when the row is in it', () => {
  assert.deepEqual(menuTargets('a', new Set(['a', 'b'])), ['a', 'b']);
  assert.deepEqual(menuTargets('c', new Set(['a', 'b'])), ['c']);
  assert.deepEqual(menuTargets('a', new Set()), ['a']);
});

test('chunk splits into fixed-size parts', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 50), []);
  assert.equal(chunk(Array.from({ length: 120 }, (_, i) => i), 50).length, 3);
});

test('capList keeps newest 20', () => {
  let list = [];
  for (let i = 1; i <= 25; i++) list = capList(list, i, 20);
  assert.equal(list.length, 20);
  assert.equal(list[0], 25);
  assert.equal(list[19], 6);
});

test('groupColor stable', () => {
  const a = groupColor('cg-fedda547-c73b-4b02-b1be-3eefad86ac38');
  assert.deepEqual(groupColor('cg-fedda547-c73b-4b02-b1be-3eefad86ac38'), a);
  for (const id of ['cg-1', 'cg-2', 'cg-3', 'cg-xyz', '']) {
    const { bg, fg } = groupColor(id);
    const n = Number(/--tint-(\d+)-bg/.exec(bg)[1]);
    assert.ok(n >= 1 && n <= TINT_COUNT);
    assert.equal(fg, `var(--tint-${n}-fg)`);
  }
  assert.equal(TINT_COUNT, 8);
});

test('mapLimit never exceeds limit', async () => {
  let active = 0;
  let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async n => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 5));
    active--;
    return n * 2;
  });
  assert.equal(peak, 4);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
});

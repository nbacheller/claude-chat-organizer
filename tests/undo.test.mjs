import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBatch, planUndo } from '../extension/src/undo.js';

test('makeBatch records kind and changes', () => {
  const b = makeBatch('rename', [{ uuid: 'a', before: 'Old', after: 'New' }]);
  assert.equal(b.kind, 'rename');
  assert.equal(b.changes.length, 1);
  assert.equal(typeof b.id, 'string');
  assert.ok(!Number.isNaN(Date.parse(b.at)));
});

test('rename undo skips edited chats', () => {
  const b = makeBatch('rename', [
    { uuid: 'a', before: 'Topic A', after: '10/29/26 - Topic A - 9/1/26' },
    { uuid: 'b', before: 'Topic B', after: '10/29/26 - Topic B - 9/2/26' },
    { uuid: 'gone', before: 'X', after: 'Y' },
  ]);
  const current = new Map([
    ['a', { uuid: 'a', name: '10/29/26 - Topic A - 9/1/26' }],
    ['b', { uuid: 'b', name: 'Renamed by hand' }],
  ]);
  assert.deepEqual(planUndo(b, current), [{ uuid: 'a', value: 'Topic A' }]);
});

test('project undo restores null', () => {
  const b = makeBatch('project', [
    { uuid: 'a', before: null, after: 'p1' },
    { uuid: 'b', before: 'p2', after: 'p1' },
  ]);
  const current = new Map([
    ['a', { uuid: 'a', project_uuid: 'p1' }],
    ['b', { uuid: 'b', project_uuid: 'p3' }],
  ]);
  assert.deepEqual(planUndo(b, current), [{ uuid: 'a', value: null }]);
});

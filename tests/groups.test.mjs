import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORE_KEY, GroupsShapeError, readStore, listGroups, groupIdOf, moveChats, restoreMembership, writeStore,
} from '../extension/src/groups.js';
import { storeState, settingsRecord } from './fixtures/store.mjs';

const fresh = () => readStore(settingsRecord());
const sectionOf = (store, id) => store.state.sidebarSections.find(s => s.id === id);
const everywhere = (store, key) => {
  const s = store.state;
  const hits = [];
  if (key in s.customGroupAssignments) hits.push('assignments');
  for (const [gid, list] of Object.entries(s.customGroupOrder)) if (list.includes(key)) hits.push('order:' + gid);
  for (const sec of s.sidebarSections) if ((sec.members || []).includes(key)) hits.push('members:' + sec.id);
  return hits;
};

test('reads groups', () => {
  assert.deepEqual(listGroups(fresh()), [{ id: 'cg-a', name: 'Client Deals' }, { id: 'cg-b', name: 'Side Project' }]);
  assert.equal(groupIdOf(fresh(), '1'), 'cg-a');
  assert.equal(groupIdOf(fresh(), '3'), null);
});

test('orphan assignment reads as ungrouped', () => {
  assert.equal(groupIdOf(fresh(), '9'), null);
});

test('move into group syncs all three places', () => {
  const s = moveChats(fresh(), ['3'], 'cg-b').state;
  assert.equal(s.customGroupAssignments['chat:3'], 'cg-b');
  assert.ok(s.customGroupOrder['cg-b'].includes('chat:3'));
  assert.ok(sectionOf({ state: s }, 'cg-b').members.includes('chat:3'));
});

test('move between groups leaves no trace', () => {
  const out = moveChats(fresh(), ['1'], 'cg-b');
  assert.deepEqual(everywhere(out, 'chat:1').sort(), ['assignments', 'members:cg-b', 'order:cg-b']);
  assert.equal(out.state.customGroupAssignments['chat:1'], 'cg-b');
});

test('remove from group', () => {
  const out = moveChats(fresh(), ['2'], null);
  assert.deepEqual(everywhere(out, 'chat:2'), []);
  assert.deepEqual(sectionOf(out, 'cg-a').members, ['chat:1']);
});

test('move cleans orphan assignment', () => {
  const out = moveChats(fresh(), ['9'], 'cg-a');
  assert.equal(out.state.customGroupAssignments['chat:9'], 'cg-a');
  assert.equal('cg-gone' in out.state.customGroupOrder, false);
  assert.deepEqual(everywhere(out, 'chat:9').sort(), ['assignments', 'members:cg-a', 'order:cg-a']);
});

test('cowork members survive', () => {
  let out = moveChats(fresh(), ['1', '3'], 'cg-b');
  out = moveChats(out, ['1'], null);
  assert.equal(out.state.customGroupAssignments['cowork:x'], 'cg-b');
  assert.ok(out.state.customGroupOrder['cg-b'].includes('cowork:x'));
  assert.ok(sectionOf(out, 'cg-b').members.includes('cowork:x'));
});

test('unrelated keys preserved', () => {
  const before = fresh();
  const out = moveChats(before, ['1', '3'], 'cg-b');
  for (const k of ['pinnedOrder', 'navPinnedIds', 'recentsStatusFilter', 'groupByByMode', 'coworkActivityDays', 'customGroups']) {
    assert.deepEqual(out.state[k], before.state[k], k);
  }
  assert.deepEqual(sectionOf(out, 'pinned'), sectionOf(before, 'pinned'));
  assert.deepEqual(sectionOf(out, 'routines'), sectionOf(before, 'routines'));
  const { members: _a, ...restBefore } = sectionOf(before, 'cg-b');
  const { members: _b, ...restAfter } = sectionOf(out, 'cg-b');
  assert.deepEqual(restAfter, restBefore);
  assert.equal(out.version, before.version);
});

test('writeStore keeps other entries identical', () => {
  const record = settingsRecord();
  const content = writeStore(record, moveChats(readStore(record), ['3'], 'cg-a'));
  for (const k of Object.keys(record.content.entries)) {
    if (k !== STORE_KEY) assert.equal(content.entries[k], record.content.entries[k], k);
  }
  assert.equal(JSON.parse(content.entries[STORE_KEY]).state.customGroupAssignments['chat:3'], 'cg-a');
  assert.notEqual(content, record.content);
});

test('unknown target throws', () => {
  assert.throws(() => moveChats(fresh(), ['3'], 'cg-nope'), /cg-nope/);
});

test('input not mutated', () => {
  const input = fresh();
  const snapshot = structuredClone(input);
  moveChats(input, ['1', '9'], 'cg-b');
  restoreMembership(input, readStore(settingsRecord()));
  assert.deepEqual(input, snapshot);
});

test('restore keeps current groups', () => {
  const backup = readStore(settingsRecord());
  let current = moveChats(fresh(), ['1'], 'cg-b');
  current.state.customGroups.push({ id: 'cg-c', name: 'New group' });
  current.state.sidebarSections.push({ id: 'cg-c', kind: 'manual', name: 'New group', order: 4, members: [] });
  current.state.customGroupOrder['cg-c'] = [];
  current.state.recentsStatusFilter = 'all';
  const out = restoreMembership(current, backup);
  assert.ok(out.state.customGroups.some(g => g.id === 'cg-c'));
  assert.equal(sectionOf(out, 'cg-c').name, 'New group');
  assert.deepEqual(sectionOf(out, 'cg-c').members, []);
  assert.equal(out.state.customGroupAssignments['chat:1'], 'cg-a');
  assert.deepEqual(sectionOf(out, 'cg-a').members, ['chat:1', 'chat:2']);
  assert.deepEqual(sectionOf(out, 'cg-b').members, ['cowork:x']);
  assert.equal(out.state.recentsStatusFilter, 'all');
  assert.equal('chat:9' in out.state.customGroupAssignments, false);
  assert.equal('cg-gone' in out.state.customGroupOrder, false);
});

test('shape error', () => {
  const s = storeState();
  delete s.state.customGroups;
  assert.throws(() => readStore(settingsRecord(s)), GroupsShapeError);
  assert.throws(() => readStore({ content: { entries: {} } }), GroupsShapeError);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDate, stripToolDates, buildName, isRenameEligible, planRename, orderForRename, hasToolDates, isStaleName,
} from '../extension/src/naming.js';

test('isStaleName flags dated names that no longer match', () => {
  const at = (y, m, d) => ({ at: new Date(y, m - 1, d, 12).toISOString(), approx: false });
  const c = (name, over = {}) => ({
    uuid: 'x', name, created_at: new Date(2026, 7, 14, 12).toISOString(),
    is_archived: false, is_temporary: false, is_multiplayer: false, ...over,
  });
  assert.equal(isStaleName(c('10/2/26 - Contract review checklist - 8/14/26'), at(2026, 10, 21)), true);
  assert.equal(isStaleName(c('10/21/26 - Contract review checklist - 8/14/26'), at(2026, 10, 21)), false);
  assert.equal(isStaleName(c('Contract review checklist - 8/14/26'), at(2026, 10, 21)), true);
  assert.equal(isStaleName(c('Contract review checklist'), at(2026, 10, 21)), false);
  assert.equal(isStaleName(c('10/2/26 - Contract review checklist - 8/14/26'), { ...at(2026, 10, 21), approx: true }), false);
  assert.equal(isStaleName(c('10/2/26 - Contract review checklist - 8/14/26'), null), false);
  assert.equal(isStaleName(c('10/2/26 - Contract review checklist - 8/14/26', { is_multiplayer: true }), at(2026, 10, 21)), false);
});

test('hasToolDates spots renamed names only', () => {
  assert.equal(hasToolDates('10/1/26 - Project API - 3/1/26'), true);
  assert.equal(hasToolDates('9/30/26 - Team - 9/30 weekly summary - 9/30/26'), true);
  assert.equal(hasToolDates('Project API'), false);
  assert.equal(hasToolDates('10/1/26 - Topic'), false);
  assert.equal(hasToolDates('Topic - 3/1/26'), false);
  assert.equal(hasToolDates('Q3 plan - 9/30/26 review'), false);
  assert.equal(hasToolDates('10/1/26 - 3/1/26'), false);
  assert.equal(hasToolDates(''), false);
  assert.equal(hasToolDates(null), false);
});

const local = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const chat = (over = {}) => ({
  uuid: 'c1',
  name: 'Contract review checklist',
  created_at: local(2026, 8, 14).toISOString(),
  updated_at: local(2026, 10, 21).toISOString(),
  is_archived: false,
  is_temporary: false,
  is_multiplayer: false,
  ...over,
});
const act = (date, approx = false) => ({ at: date.toISOString(), approx });

test('formats in local time', () => {
  assert.equal(formatDate(local(2026, 10, 1, 23, 59)), '10/1/26');
  assert.equal(formatDate(local(2026, 3, 1, 0, 1)), '3/1/26');
  assert.equal(formatDate(local(2026, 3, 1, 0, 1).toISOString()), '3/1/26');
});

test('builds the agreed format', () => {
  assert.equal(buildName('Project API', local(2026, 10, 1), local(2026, 3, 1)), '10/1/26 - Project API - 3/1/26');
});

test('strips both tool dates', () => {
  assert.deepEqual(stripToolDates('10/1/26 - Project API - 3/1/26'), { topic: 'Project API', lead: true, trail: true });
});

test('strips a lone date', () => {
  assert.deepEqual(stripToolDates('10/1/26 - Topic'), { topic: 'Topic', lead: true, trail: false });
  assert.deepEqual(stripToolDates('Topic - 3/1/26'), { topic: 'Topic', lead: false, trail: true });
});

test('mid-title dates are topic', () => {
  assert.equal(stripToolDates('Q3 plan - 9/30/26 review').topic, 'Q3 plan - 9/30/26 review');
  assert.deepEqual(stripToolDates('AI 1.2 PRD - draft'), { topic: 'AI 1.2 PRD - draft', lead: false, trail: false });
});

test('fresh name gets both dates', () => {
  const p = planRename(chat(), act(local(2026, 10, 21)));
  assert.equal(p.newName, '10/21/26 - Contract review checklist - 8/14/26');
  assert.equal(p.changed, true);
  assert.equal(p.skip, null);
});

test('refresh only updates lead date', () => {
  const p = planRename(chat({ name: '10/2/26 - Contract review checklist - 8/14/26' }), act(local(2026, 10, 21)));
  assert.equal(p.newName, '10/21/26 - Contract review checklist - 8/14/26');
  assert.equal(p.changed, true);
  assert.equal(p.partial, false);
});

test('current name is unchanged', () => {
  const p = planRename(chat({ name: '10/2/26 - Contract review checklist - 8/14/26' }), act(local(2026, 10, 2)));
  assert.equal(p.changed, false);
});

test('partial flagged', () => {
  const p = planRename(chat({ name: 'Contract review checklist - 8/14/26' }), act(local(2026, 10, 21)));
  assert.equal(p.partial, true);
  assert.equal(p.newName, '10/21/26 - Contract review checklist - 8/14/26');
});

test('skips', () => {
  assert.equal(isRenameEligible(chat()), true);
  assert.equal(planRename(chat({ is_multiplayer: true }), act(local(2026, 10, 21))).skip, 'ineligible');
  assert.equal(planRename(chat({ is_archived: true }), act(local(2026, 10, 21))).skip, 'ineligible');
  assert.equal(planRename(chat({ is_temporary: true }), act(local(2026, 10, 21))).skip, 'ineligible');
  assert.equal(planRename(chat({ name: '' }), act(local(2026, 10, 21))).skip, 'ineligible');
  assert.equal(planRename(chat(), null).skip, 'no-activity');
  assert.equal(planRename(chat(), act(local(2026, 10, 21), true)).skip, 'approx-activity');
  assert.equal(planRename(chat({ name: '10/1/26 - ' }), act(local(2026, 10, 21))).skip, 'empty-topic');
  const skipped = planRename(chat({ is_multiplayer: true }), act(local(2026, 10, 21)));
  assert.equal(skipped.changed, false);
  assert.equal(skipped.newName, skipped.oldName);
});

test('oldest first', () => {
  const plans = [
    { uuid: 'b', lastUsed: local(2026, 10, 2).toISOString() },
    { uuid: 'a', lastUsed: local(2026, 1, 5).toISOString() },
    { uuid: 'c', lastUsed: local(2026, 10, 29).toISOString() },
  ];
  assert.deepEqual(orderForRename(plans).map(p => p.uuid), ['a', 'b', 'c']);
  assert.deepEqual(plans.map(p => p.uuid), ['b', 'a', 'c']);
});

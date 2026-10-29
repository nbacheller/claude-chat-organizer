import { loadEnv } from './src/env.js';
import { formatDate, planRename, orderForRename, hasToolDates, isStaleName } from './src/naming.js';
import {
  readStore, listGroups, groupIdOf, moveChats, restoreMembership, writeStore, GroupsShapeError, StaleSettingsError,
} from './src/groups.js';
import { resolveLastUsed } from './src/activity.js';
import { makeBatch, planUndo } from './src/undo.js';
import { chunk, groupColor, mapLimit, menuTargets, sleep } from './src/util.js';

const PAUSE_MS = 500;
const PROJECT_CHUNK = 50;
const ACTIVITY_CONCURRENCY = 2;
const isLimited = e => e && (e.status === 429 || e.status === 503);
// claude.ai's sidebar lists a pinned chat only under Pinned, even when it belongs to a group.
const PINNED_NOTE = 'Pinned in claude.ai, so the sidebar shows it under Pinned instead of its group';
const SKIP_LABELS = {
  ineligible: 'shared, archived or untitled',
  'no-activity': 'no activity date',
  'approx-activity': 'activity date unknown',
  'empty-topic': 'nothing left after removing dates',
};

const $ = id => document.getElementById(id);
const state = {
  env: null, org: null, chats: [], projects: [], record: null, store: null, groupsOff: false,
  activity: new Map(), cache: {}, activityPromise: null,
  filter: { q: '', show: 'all', group: '', project: '' },
  selected: new Set(), preview: null, busy: false,
};

// ---------- helpers ----------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const chatById = uuid => state.chats.find(c => c.uuid === uuid);
const groupName = id => (state.store ? (listGroups(state.store).find(g => g.id === id) || {}).name : null) || null;
const chatGroup = c => (state.store ? groupIdOf(state.store, c.uuid) : null);
const isUnfiled = c => !chatGroup(c) && !c.project_uuid;
const activityOf = c => state.activity.get(c.uuid);
const isStale = c => {
  const act = activityOf(c);
  return Boolean(act && !act.approx && isStaleName(c, act));
};
const lastUsedOf = c => (activityOf(c) || { at: c.updated_at }).at;

function setStatus(text) {
  $('status').textContent = text || '';
}

function showBanner(text, ok = false) {
  const b = $('banner');
  b.textContent = text;
  b.classList.toggle('ok', ok);
  b.hidden = !text;
}

function askInline(text, okLabel = 'Continue') {
  return new Promise(resolve => {
    $('confirm-text').textContent = text;
    $('confirm-ok').textContent = okLabel;
    $('confirm').hidden = false;
    const done = answer => {
      $('confirm').hidden = true;
      $('confirm-ok').onclick = null;
      $('confirm-cancel').onclick = null;
      resolve(answer);
    };
    $('confirm-ok').onclick = () => done(true);
    $('confirm-cancel').onclick = () => done(false);
  });
}

function setBusy(on) {
  state.busy = on;
  for (const id of ['btn-refresh', 'btn-stale', 'btn-apply', 'btn-rename-selected', 'b-group', 'b-project', 'btn-restore', 'btn-undo', 'btn-export']) {
    $(id).disabled = on;
  }
  $('b-group').disabled = on || state.groupsOff;
  $('btn-restore').disabled = on || state.groupsOff;
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function downloadJson(obj, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Project names can repeat (two "Side Project" projects), so repeats get a chat count.
function projectLabels() {
  const counts = new Map();
  for (const p of state.projects) counts.set(p.name, (counts.get(p.name) || 0) + 1);
  return state.projects.map(p => {
    const n = state.chats.filter(c => c.project_uuid === p.uuid).length;
    return { uuid: p.uuid, label: counts.get(p.name) > 1 ? `${p.name} · ${plural(n, 'chat')}` : p.name };
  });
}

// ---------- rendering ----------

function visibleChats() {
  const { q, show, group, project } = state.filter;
  const needle = q.trim().toLowerCase();
  return state.chats
    .filter(c => !needle || (c.name || '').toLowerCase().includes(needle))
    .filter(c => show !== 'unfiled' || isUnfiled(c))
    .filter(c => show !== 'undated' || !hasToolDates(c.name))
    .filter(c => show !== 'stale' || isStale(c))
    .filter(c => !group || (group === '__none' ? !chatGroup(c) : chatGroup(c) === group))
    .filter(c => !project || (project === '__none' ? !c.project_uuid : c.project_uuid === project))
    .sort((a, b) => String(lastUsedOf(b)).localeCompare(String(lastUsedOf(a))));
}

function renderCounts() {
  const unfiled = state.chats.filter(isUnfiled).length;
  $('n-total').textContent = state.chats.length;
  $('n-unfiled').textContent = unfiled;
  $('chip-unfiled').textContent = unfiled;
  $('chip-undated').textContent = state.chats.filter(c => !hasToolDates(c.name)).length;
  $('n-group').textContent = state.chats.filter(c => chatGroup(c)).length;
  $('n-project').textContent = state.chats.filter(c => c.project_uuid).length;
}

function renderSelects() {
  const groups = state.store ? listGroups(state.store) : [];
  const projects = projectLabels();
  const opts = list => list.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  const keep = (id, html) => {
    const el = $(id);
    const v = el.value;
    el.innerHTML = html;
    if ([...el.options].some(o => o.value === v)) el.value = v;
  };
  keep('f-group', opts([['', 'Any group'], ['__none', 'No group'], ...groups.map(g => [g.id, g.name])]));
  keep('f-project', opts([['', 'Any project'], ['__none', 'No project'], ...projects.map(p => [p.uuid, p.label])]));
  $('b-group').innerHTML = opts([['', 'Move to group'], ...groups.map(g => [g.id, g.name]), ['__remove', 'Remove from group']]);
  $('b-project').innerHTML = opts([['', 'Move to project'], ...projects.map(p => [p.uuid, p.label]), ['__remove', 'Remove from project']]);
  $('f-group').disabled = state.groupsOff;
  $('b-group').disabled = state.groupsOff || state.busy;
}

function pill(text, style, cls = '') {
  return text ? `<span class="pill ${cls}" style="${style}" title="${esc(text)}">${esc(text)}</span>` : '<span class="muted">—</span>';
}

function renderRows() {
  const rows = visibleChats();
  if (!rows.length) {
    $('rows').innerHTML = '<tr><td colspan="6" class="muted">No chats match these filters.</td></tr>';
  } else {
    $('rows').innerHTML = rows.map(c => {
      const gid = chatGroup(c);
      const color = gid ? groupColor(gid) : null;
      const act = activityOf(c);
      const last = act ? formatDate(act.at) : formatDate(c.updated_at);
      const lastCls = !act || act.approx ? 'approx' : '';
      const lastTitle = !act ? 'Checking last activity' : act.approx ? 'Approximate' : '';
      const name = c.name || 'Untitled chat';
      const stale = isStale(c);
      const nameTitle = stale ? `Stale. Updating will change it to: ${planRename(c, act).newName}` : name;
      return `<tr data-id="${esc(c.uuid)}" class="${state.selected.has(c.uuid) ? 'sel' : ''}">
        <td><input type="checkbox" data-id="${esc(c.uuid)}" ${state.selected.has(c.uuid) ? 'checked' : ''} aria-label="Select ${esc(name)}"></td>
        <td title="${esc(nameTitle)}" class="${stale ? 'stale' : ''}">${c.name ? esc(c.name) : '<span class="muted">Untitled chat</span>'}${c.is_starred ? `<span class="pill pin" title="${PINNED_NOTE}">pinned</span>` : ''}${isUnfiled(c) ? '<span class="pill unfiled">unfiled</span>' : ''}</td>
        <td>${gid ? pill(groupName(gid), `background:${color.bg};color:${color.fg}`) : pill('')}</td>
        <td>${c.project ? pill(c.project.name, '', 'project') : pill('')}</td>
        <td class="muted">${formatDate(c.created_at)}</td>
        <td class="${lastCls}" title="${lastTitle}">${last}</td>
      </tr>`;
    }).join('');
  }
  const shown = rows.map(c => c.uuid);
  $('sel-all').checked = shown.length > 0 && shown.every(id => state.selected.has(id));
  const staleCount = state.chats.filter(isStale).length;
  $('chip-stale').textContent = staleCount;
  $('btn-stale').textContent = staleCount ? `Update ${plural(staleCount, 'stale name')}` : 'Update stale names';
}

function renderBulk() {
  $('bulk').hidden = state.selected.size === 0;
  $('bulk-n').textContent = `${state.selected.size} selected`;
}

function render() {
  renderCounts();
  renderSelects();
  renderRows();
  renderBulk();
}

// ---------- loading ----------

async function load() {
  const { api, storage, isMock } = state.env;
  $('mock-badge').hidden = !isMock;
  setStatus('Loading your chats…');
  state.org = await api.getOrg();
  $('org-name').textContent = state.org.name;
  const [chats, projects, record] = await Promise.all([
    api.listChats(state.org),
    api.listProjects(state.org),
    api.getUserSettings(state.org).catch(e => ({ __loadError: e })),
  ]);
  state.chats = chats;
  state.projects = projects.filter(p => !p.archived);
  setSettings(record);
  state.cache = await storage.getCache();
  for (const c of chats) {
    const hit = state.cache[c.uuid];
    if (hit && hit.updated_at === c.updated_at) state.activity.set(c.uuid, { at: hit.lastUsed, approx: false });
  }
  $('opt-reminder').checked = await storage.getFlag('desktopReminder');
  render();
  setStatus('');
  state.activityPromise = resolveActivity();
}

function setSettings(record) {
  try {
    if (record && record.__loadError) throw record.__loadError;
    state.store = readStore(record);
    state.record = record;
    state.groupsOff = false;
  } catch (e) {
    state.store = null;
    state.record = null;
    state.groupsOff = true;
    const why = e instanceof GroupsShapeError ? '' : ` (${e.message})`;
    showBanner(`Couldn't read your sidebar groups. Group features are off.${why}`);
  }
}

// Looks up chats with no date yet, or only an approximate one from an earlier failed lookup.
async function resolveActivity() {
  const { api, storage } = state.env;
  const todo = state.chats.filter(c => !state.activity.has(c.uuid) || state.activity.get(c.uuid).approx);
  let done = 0;
  await mapLimit(todo, ACTIVITY_CONCURRENCY, async c => {
    const act = await resolveLastUsed(c, state.cache, uuid => api.getLastMessageAt(state.org, uuid));
    state.activity.set(c.uuid, act);
    done++;
    setStatus(`Checking last activity ${done} of ${todo.length}`);
    if (done % 25 === 0) {
      await storage.setCache(state.cache);
      renderRows();
    }
  });
  await storage.setCache(state.cache);
  const approx = todo.filter(c => state.activity.get(c.uuid).approx).length;
  if (todo.length) {
    setStatus(`Last activity checked for ${plural(todo.length, 'chat')}.${approx ? ` ${approx} couldn't be read and will be retried next time.` : ''}`);
  }
  renderRows();
}

// ---------- renaming ----------

// scope: 'all' chats, the 'selected' rows, or only 'stale' names.
async function openPreview(scope) {
  if (state.activityPromise) {
    setStatus('Finishing the last-activity check…');
    await state.activityPromise;
  }
  if (state.chats.some(c => (activityOf(c) || {}).approx)) {
    setStatus('Rechecking chats whose last activity couldn’t be read…');
    state.activityPromise = resolveActivity();
    await state.activityPromise;
  }
  const pool = scope === 'selected' ? state.chats.filter(c => state.selected.has(c.uuid))
    : scope === 'stale' ? state.chats.filter(isStale)
      : state.chats;
  const plans = pool.map(c => planRename(c, activityOf(c) || null));
  const changing = plans.filter(p => p.changed);
  const skips = {};
  for (const p of plans) if (p.skip) skips[p.skip] = (skips[p.skip] || 0) + 1;
  state.preview = orderForRename(changing);

  $('preview-summary').textContent = `${changing.length} of ${pool.length} names change`;
  const skipText = Object.entries(skips).map(([k, n]) => `${n} ${SKIP_LABELS[k] || k}`).join(', ');
  const retryHint = skips['approx-activity'] ? ' Run Refresh names again later to pick up the ones whose activity date is unknown.' : '';
  $('preview-skips').textContent = skipText ? `Skipped: ${skipText}.${retryHint}` : '';
  $('preview-list').innerHTML = changing.length
    ? state.preview.map(p => `<div class="preview-row">
        <span class="old" title="${esc(p.oldName)}">${esc(p.oldName)}</span><span class="muted">→</span>
        <span title="${esc(p.newName)}">${esc(p.newName)}</span>
        ${p.partial ? '<span class="pill partial" title="Only one of the two dates was found in the old name">check</span>' : '<span></span>'}
      </div>`).join('')
    : '<p class="muted">Every name is already up to date.</p>';
  $('btn-apply').hidden = changing.length === 0;
  $('preview').hidden = false;
  setStatus('');
  $('preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function applyRenames() {
  const plans = state.preview || [];
  if (!plans.length) return;
  const { api, storage } = state.env;
  setBusy(true);
  const changes = [];
  const failures = [];
  let limited = false;
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i];
    setStatus(`Renaming ${i + 1} of ${plans.length}… Keep this tab open.`);
    try {
      const updated = await api.renameChat(state.org, p.uuid, p.newName);
      const c = chatById(p.uuid);
      c.name = p.newName;
      if (updated && updated.updated_at) {
        c.updated_at = updated.updated_at;
        if (state.cache[p.uuid]) state.cache[p.uuid].updated_at = updated.updated_at;
      }
      changes.push({ uuid: p.uuid, before: p.oldName, after: p.newName });
    } catch (e) {
      if (isLimited(e)) {
        limited = true;
        break;
      }
      failures.push(`${p.oldName}: ${e.message}`);
    }
    await sleep(PAUSE_MS);
  }
  if (changes.length) await storage.pushBatch(makeBatch('rename', changes));
  await storage.setCache(state.cache);
  state.preview = null;
  $('preview').hidden = true;
  setBusy(false);
  render();
  setStatus(`Renamed ${changes.length} of ${plans.length}.`);
  if (limited) {
    showBanner(`claude.ai is limiting requests, so renaming stopped after ${changes.length}. Wait a few minutes, then press Refresh names again. It picks up where it left off.`);
  } else {
    showBanner(failures.length ? `${failures.length} renames failed: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}` : '');
  }
}

// ---------- groups ----------

async function saveGroups(transform, describe) {
  const { api, storage } = state.env;
  for (let attempt = 0; attempt < 2; attempt++) {
    const record = await api.getUserSettings(state.org);
    const store = readStore(record);
    if (!(await storage.getFlag('firstGroupWriteDone'))) {
      downloadJson(record, `claude-sidebar-backup-${stamp()}.json`);
      await storage.setFlag('firstGroupWriteDone', true);
    }
    await storage.pushBackup(record);
    const next = transform(store);
    try {
      await api.saveUserSettings(state.org, record, writeStore(record, next));
      const verify = await api.getUserSettings(state.org);
      setSettings(verify);
      return describe(state.store, next);
    } catch (e) {
      if (e instanceof StaleSettingsError && attempt === 0) continue;
      throw e;
    }
  }
  return false;
}

async function moveToGroup(chatUuids, target) {
  const { storage } = state.env;
  const targetId = target === '__remove' ? null : target;
  const uuids = chatUuids.filter(u => groupIdOf(state.store, u) !== targetId);
  if (!uuids.length) {
    setStatus(targetId ? `Already in ${groupName(targetId)}.` : 'Not in a group.');
    return;
  }
  if (await storage.getFlag('desktopReminder')) {
    if (!(await askInline('Close the Claude desktop app before filing.', 'Continue'))) return;
  }
  setBusy(true);
  setStatus('Saving group change…');
  try {
    const stuck = await saveGroups(
      store => moveChats(store, uuids, targetId),
      saved => uuids.every(u => groupIdOf(saved, u) === targetId),
    );
    if (!stuck) showBanner("Your group change didn't stick. Close the Claude desktop app and try again.");
    else {
      showBanner('');
      const pinned = targetId ? uuids.filter(u => (chatById(u) || {}).is_starred).length : 0;
      const pinNote = pinned ? ` ${pinned === 1 ? 'It’s' : `${pinned} of them are`} pinned, so the sidebar keeps showing ${pinned === 1 ? 'it' : 'them'} under Pinned until unpinned.` : '';
      setStatus(`${plural(uuids.length, 'chat')} ${targetId ? `moved to ${groupName(targetId)}` : 'removed from their group'}.${pinNote}`);
    }
    for (const u of chatUuids) state.selected.delete(u);
  } catch (e) {
    showBanner(`Couldn't save the group change: ${e.message}`);
    setStatus('');
  }
  setBusy(false);
  render();
}

async function restoreLastBackup() {
  const { storage } = state.env;
  const [latest] = await storage.getBackups();
  if (!latest) {
    setStatus('No backup saved yet.');
    return;
  }
  const when = new Date(latest.at).toLocaleString();
  if (!(await askInline(`Restore group memberships from the backup saved ${when}? Other sidebar settings stay as they are.`, 'Restore'))) return;
  setBusy(true);
  try {
    const backupStore = readStore(latest.record);
    let expected = null;
    const ok = await saveGroups(
      store => (expected = restoreMembership(store, backupStore)),
      saved => JSON.stringify(saved.state.customGroupAssignments) === JSON.stringify(expected.state.customGroupAssignments),
    );
    showBanner(ok ? 'Group memberships restored.' : "The restore didn't stick. Close the Claude desktop app and try again.", ok);
  } catch (e) {
    showBanner(`Couldn't restore: ${e.message}`);
  }
  setBusy(false);
  render();
}

async function exportBackup() {
  const { api, storage } = state.env;
  const [latest] = await storage.getBackups();
  const record = latest ? latest.record : await api.getUserSettings(state.org);
  downloadJson(record, `claude-sidebar-backup-${stamp()}.json`);
  setStatus(latest ? `Exported the backup saved ${new Date(latest.at).toLocaleString()}.` : 'Exported your current sidebar settings.');
}

// ---------- projects ----------

async function moveToProject(chatUuids, target) {
  const { api, storage } = state.env;
  const projectUuid = target === '__remove' ? null : target;
  const project = state.projects.find(p => p.uuid === projectUuid) || null;
  const todo = chatUuids.map(chatById).filter(c => c && (c.project_uuid || null) !== projectUuid);
  if (!todo.length) {
    setStatus(project ? `Already in ${project.name}.` : 'Not in a project.');
    return;
  }
  setBusy(true);
  const changes = [];
  const failures = [];
  const batches = chunk(todo, PROJECT_CHUNK);
  for (let i = 0; i < batches.length; i++) {
    setStatus(`Updating projects ${Math.min((i + 1) * PROJECT_CHUNK, todo.length)} of ${todo.length}…`);
    try {
      const res = await api.moveToProject(state.org, batches[i].map(c => c.uuid), projectUuid);
      const moved = new Set(res.moved);
      for (const c of batches[i]) {
        if (!moved.has(c.uuid)) {
          failures.push(`${c.name}: ${res.reasons[c.uuid] || 'not moved'}`);
          continue;
        }
        changes.push({ uuid: c.uuid, before: c.project_uuid || null, after: projectUuid });
        c.project_uuid = projectUuid;
        c.project = project ? { uuid: project.uuid, name: project.name } : null;
      }
    } catch (e) {
      for (const c of batches[i]) failures.push(`${c.name}: ${e.message}`);
    }
    await sleep(PAUSE_MS);
  }
  if (changes.length) await storage.pushBatch(makeBatch('project', changes));
  for (const u of chatUuids) state.selected.delete(u);
  setBusy(false);
  render();
  setStatus(`${plural(changes.length, 'chat')} ${projectUuid ? `moved to ${project.name}` : 'removed from their project'}.`);
  showBanner(failures.length ? `${failures.length} project changes failed: ${failures.slice(0, 3).join('; ')}` : '');
}

// ---------- undo ----------

async function undoLastBatch() {
  const { api, storage } = state.env;
  const [batch] = await storage.getBatches();
  if (!batch) {
    setStatus('Nothing to undo.');
    return;
  }
  const what = batch.kind === 'rename' ? 'rename' : 'project change';
  if (!(await askInline(`Undo the last ${what} of ${batch.changes.length} ${batch.changes.length === 1 ? 'chat' : 'chats'} (${new Date(batch.at).toLocaleString()})?`, 'Undo'))) return;
  setBusy(true);
  setStatus('Checking current names and projects…');
  try {
    const fresh = await api.listChats(state.org);
    const ops = planUndo(batch, new Map(fresh.map(c => [c.uuid, c])));
    let done = 0;
    if (batch.kind === 'rename') {
      for (const op of ops) {
        setStatus(`Undoing ${done + 1} of ${ops.length}…`);
        await api.renameChat(state.org, op.uuid, op.value);
        done++;
        await sleep(PAUSE_MS);
      }
    } else {
      const byTarget = new Map();
      for (const op of ops) byTarget.set(op.value, [...(byTarget.get(op.value) || []), op.uuid]);
      for (const [target, uuids] of byTarget) {
        for (const part of chunk(uuids, PROJECT_CHUNK)) {
          setStatus(`Undoing ${done + part.length} of ${ops.length}…`);
          const res = await api.moveToProject(state.org, part, target);
          done += res.moved.length;
          await sleep(PAUSE_MS);
        }
      }
    }
    await storage.popBatch();
    state.chats = await api.listChats(state.org);
    const left = batch.changes.length - ops.length;
    setStatus(`Undid ${done} of ${batch.changes.length}.${left ? ` ${left} were changed since and left alone.` : ''}`);
  } catch (e) {
    showBanner(`Undo stopped partway: ${e.message}`);
  }
  setBusy(false);
  render();
}

// ---------- right-click menu ----------

function openMenu(x, y, rowId) {
  const targets = menuTargets(rowId, state.selected);
  const one = targets.length === 1 ? chatById(targets[0]) : null;
  const curGroup = one ? chatGroup(one) : null;
  const curProject = one ? one.project_uuid : null;
  const item = (action, value, label, { current = false, swatch = '' } = {}) => `<button type="button" role="menuitem" data-action="${action}" data-value="${esc(value)}" title="${esc(label)}">
      <span class="tick">${current ? '✓' : ''}</span>${swatch ? `<span class="swatch" style="background:${swatch}"></span>` : ''}<span>${esc(label)}</span></button>`;
  let html = `<div class="ctx-head" title="${esc(one ? one.name : '')}">${one ? esc(one.name || 'Untitled chat') : `${targets.length} selected chats`}</div>`;
  if (one && one.is_starred) html += `<div class="ctx-note">${PINNED_NOTE}.</div>`;
  if (!state.groupsOff) {
    html += '<div class="ctx-label">Group</div>'
      + listGroups(state.store).map(g => item('group', g.id, g.name, { current: g.id === curGroup, swatch: groupColor(g.id).bg })).join('');
    if (curGroup || !one) html += item('group', '__remove', 'Remove from group');
  }
  html += '<div class="ctx-label">Project</div>'
    + projectLabels().map(p => item('project', p.uuid, p.label, { current: p.uuid === curProject })).join('');
  if (curProject || !one) html += item('project', '__remove', 'Remove from project');
  if (one) html += `<div class="ctx-sep"></div>${item('open', one.uuid, 'Open in claude.ai')}`;

  const menu = $('ctx');
  menu.innerHTML = html;
  menu.dataset.targets = JSON.stringify(targets);
  menu.hidden = false;
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
  const first = menu.querySelector('button');
  if (first) first.focus();
}

function closeMenu() {
  $('ctx').hidden = true;
}

function onMenuClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const targets = JSON.parse($('ctx').dataset.targets || '[]');
  closeMenu();
  const { action, value } = btn.dataset;
  if (action === 'group') moveToGroup(targets, value);
  else if (action === 'project') moveToProject(targets, value);
  else if (action === 'open') window.open(`https://claude.ai/chat/${encodeURIComponent(value)}`, '_blank', 'noopener');
}

// ---------- events ----------

function wire() {
  $('f-search').addEventListener('input', e => { state.filter.q = e.target.value; renderRows(); });
  document.querySelectorAll('.chip[data-show]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.chip[data-show]').forEach(b => b.classList.toggle('on', b === btn));
    state.filter.show = btn.dataset.show;
    renderRows();
  }));

  $('rows').addEventListener('contextmenu', e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr || state.busy || !state.env) return;
    e.preventDefault();
    const box = tr.getBoundingClientRect();
    const fromKeyboard = e.clientX === 0 && e.clientY === 0;
    openMenu(fromKeyboard ? box.left + 48 : e.clientX, fromKeyboard ? box.bottom : e.clientY, tr.dataset.id);
  });
  $('ctx').addEventListener('click', onMenuClick);
  $('ctx').addEventListener('keydown', e => {
    const items = [...$('ctx').querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') closeMenu();
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  document.addEventListener('mousedown', e => { if (!$('ctx').hidden && !$('ctx').contains(e.target)) closeMenu(); });
  addEventListener('resize', closeMenu);
  addEventListener('blur', closeMenu);
  document.addEventListener('scroll', e => { if (!$('ctx').contains(e.target)) closeMenu(); }, true);
  $('f-group').addEventListener('change', e => { state.filter.group = e.target.value; renderRows(); });
  $('f-project').addEventListener('change', e => { state.filter.project = e.target.value; renderRows(); });

  $('rows').addEventListener('change', e => {
    const id = e.target.dataset.id;
    if (!id) return;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    e.target.closest('tr').classList.toggle('sel', e.target.checked);
    $('sel-all').checked = visibleChats().every(c => state.selected.has(c.uuid));
    renderBulk();
  });
  $('sel-all').addEventListener('change', e => {
    for (const c of visibleChats()) {
      if (e.target.checked) state.selected.add(c.uuid);
      else state.selected.delete(c.uuid);
    }
    renderRows();
    renderBulk();
  });
  $('btn-clear').addEventListener('click', () => { state.selected.clear(); renderRows(); renderBulk(); });

  $('btn-refresh').addEventListener('click', () => openPreview('all'));
  $('btn-stale').addEventListener('click', () => openPreview('stale'));
  $('btn-rename-selected').addEventListener('click', () => openPreview('selected'));
  $('btn-preview-close').addEventListener('click', () => { $('preview').hidden = true; state.preview = null; });
  $('btn-apply').addEventListener('click', applyRenames);

  $('b-group').addEventListener('change', e => {
    const v = e.target.value;
    e.target.value = '';
    if (v) moveToGroup([...state.selected], v);
  });
  $('b-project').addEventListener('change', e => {
    const v = e.target.value;
    e.target.value = '';
    if (v) moveToProject([...state.selected], v);
  });

  $('btn-export').addEventListener('click', () => exportBackup().catch(e => showBanner(`Couldn't export: ${e.message}`)));
  $('btn-restore').addEventListener('click', restoreLastBackup);
  $('btn-undo').addEventListener('click', undoLastBatch);
  $('opt-reminder').addEventListener('change', e => state.env.storage.setFlag('desktopReminder', e.target.checked));
}

(async () => {
  wire();
  try {
    state.env = await loadEnv();
    state.env.api.onWait = (ms, attempt) => setStatus(`claude.ai asked to slow down. Waiting ${Math.round(ms / 1000)}s before retrying (try ${attempt})…`);
    await load();
  } catch (e) {
    setStatus('');
    $('org-name').textContent = 'Not connected';
    showBanner(`Couldn't load your chats: ${e.message}. Make sure you're signed in to claude.ai in this browser.`);
  }
})();

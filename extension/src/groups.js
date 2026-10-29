// Edits to claude.ai's sidebar store (user_settings -> entries["ccd/dframe-store"]).
// Group membership lives in three places that must stay in sync:
// customGroupAssignments, customGroupOrder and sidebarSections[].members.

export const STORE_KEY = 'ccd/dframe-store';

export class GroupsShapeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GroupsShapeError';
  }
}

// The settings save was rejected because someone else saved first.
export class StaleSettingsError extends Error {
  constructor(message = 'Sidebar settings changed since they were read') {
    super(message);
    this.name = 'StaleSettingsError';
  }
}

export function readStore(record) {
  const raw = record && record.content && record.content.entries && record.content.entries[STORE_KEY];
  if (typeof raw !== 'string') throw new GroupsShapeError(`Missing ${STORE_KEY} entry`);
  let store;
  try {
    store = JSON.parse(raw);
  } catch (e) {
    throw new GroupsShapeError(`Unreadable ${STORE_KEY}: ${e.message}`);
  }
  const s = store && store.state;
  const ok = s && Array.isArray(s.customGroups) && isObject(s.customGroupAssignments)
    && isObject(s.customGroupOrder) && Array.isArray(s.sidebarSections);
  if (!ok) throw new GroupsShapeError('Sidebar store is missing group fields');
  return store;
}

export function listGroups(store) {
  return store.state.customGroups.map(g => ({ id: g.id, name: g.name }));
}

export function groupIdOf(store, chatUuid) {
  const gid = store.state.customGroupAssignments[chatKey(chatUuid)];
  return gid && groupIds(store).has(gid) ? gid : null;
}

export function moveChats(store, chatUuids, targetGroupId) {
  const out = structuredClone(store);
  const s = out.state;
  const ids = groupIds(out);
  if (targetGroupId !== null && !ids.has(targetGroupId)) throw new Error(`Unknown group ${targetGroupId}`);
  const keys = chatUuids.map(chatKey);
  const moving = new Set(keys);

  for (const key of keys) delete s.customGroupAssignments[key];
  for (const [gid, list] of Object.entries(s.customGroupOrder)) {
    const kept = list.filter(k => !moving.has(k));
    if (!ids.has(gid) && kept.length === 0) delete s.customGroupOrder[gid];
    else s.customGroupOrder[gid] = kept;
  }
  for (const sec of s.sidebarSections) {
    if (Array.isArray(sec.members)) sec.members = sec.members.filter(k => !moving.has(k));
  }

  if (targetGroupId !== null) {
    for (const key of keys) s.customGroupAssignments[key] = targetGroupId;
    s.customGroupOrder[targetGroupId] = [...keys, ...(s.customGroupOrder[targetGroupId] || [])];
    const sec = s.sidebarSections.find(x => x.id === targetGroupId);
    if (sec) sec.members = [...keys, ...(sec.members || [])];
  }
  out.updatedAt = Date.now();
  return out;
}

// Puts back the backup's memberships for groups that still exist. Groups the
// backup doesn't know about keep their current members; nothing else changes.
export function restoreMembership(current, backup) {
  const out = structuredClone(current);
  const s = out.state;
  const b = backup.state;
  const ids = groupIds(out);
  const backupIds = new Set(b.customGroups.map(g => g.id));

  const assignments = {};
  for (const [k, gid] of Object.entries(s.customGroupAssignments)) {
    if (ids.has(gid) && !backupIds.has(gid)) assignments[k] = gid;
  }
  for (const [k, gid] of Object.entries(b.customGroupAssignments)) {
    if (ids.has(gid)) assignments[k] = gid;
  }
  const membersFor = (gid, currentList) => {
    const source = backupIds.has(gid) ? (b.customGroupOrder[gid] || []) : (currentList || []);
    return source.filter(k => assignments[k] === gid);
  };

  const order = {};
  for (const gid of ids) order[gid] = membersFor(gid, s.customGroupOrder[gid]);
  for (const sec of s.sidebarSections) {
    if (ids.has(sec.id) && Array.isArray(sec.members)) {
      const backupSec = b.sidebarSections.find(x => x.id === sec.id);
      const source = backupSec && Array.isArray(backupSec.members) ? backupSec.members : sec.members;
      sec.members = source.filter(k => assignments[k] === sec.id);
    }
  }
  s.customGroupAssignments = assignments;
  s.customGroupOrder = order;
  out.updatedAt = Date.now();
  return out;
}

export function writeStore(record, store) {
  return { ...record.content, entries: { ...record.content.entries, [STORE_KEY]: JSON.stringify(store) } };
}

function chatKey(uuid) {
  return `chat:${uuid}`;
}

function groupIds(store) {
  return new Set(store.state.customGroups.map(g => g.id));
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

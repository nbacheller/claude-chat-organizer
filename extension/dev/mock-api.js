// In-memory stand-in for api.js, same method names. Writes log to the console.
import { buildFixture } from './fixture.js';
import { StaleSettingsError } from '../src/groups.js';

const db = buildFixture();
const wait = ms => new Promise(r => setTimeout(r, ms));
// ?ratelimit=soft: some calls get a one-off 429. ?ratelimit=hard: renames after the 3rd always get 429.
const rateMode = new URLSearchParams(location.search).get('ratelimit');
let calls = 0;
let renames = 0;
const tooMany = () => Object.assign(new Error('Rate limited (429)'), { status: 429, retryAfter: '1' });
function maybeLimit(kind) {
  calls++;
  if (rateMode === 'soft' && calls % 5 === 0) throw tooMany();
  if (rateMode === 'hard' && kind === 'rename' && ++renames > 3) throw tooMany();
}
const clone = v => structuredClone(v);
const find = uuid => {
  const c = db.chats.find(x => x.uuid === uuid);
  if (!c) throw new Error(`No chat ${uuid}`);
  return c;
};

export const mockApi = {
  async getOrg() { await wait(50); return clone(db.org); },
  async listChats() { await wait(120); return clone(db.chats); },
  async getLastMessageAt(org, uuid) { await wait(40); maybeLimit('read'); return db.lastMessageAt[uuid] || null; },
  async listProjects() { await wait(60); return clone(db.projects); },
  async getUserSettings() { await wait(60); return clone(db.record); },
  async renameChat(org, uuid, name) {
    await wait(30);
    maybeLimit('rename');
    const c = find(uuid);
    c.name = name;
    c.updated_at = new Date().toISOString();
    console.log('[mock] rename', uuid, '→', name);
    return clone(c);
  },
  async moveToProject(org, uuids, projectUuid) {
    await wait(30);
    const p = db.projects.find(x => x.uuid === projectUuid) || null;
    for (const uuid of uuids) {
      const c = find(uuid);
      c.project_uuid = p ? p.uuid : null;
      c.project = p ? { uuid: p.uuid, name: p.name } : null;
      c.updated_at = new Date().toISOString();
    }
    console.log('[mock] project', uuids, '→', projectUuid);
    return { moved: [...uuids], failed: [], reasons: {} };
  },
  async saveUserSettings(org, baseRecord, content) {
    await wait(80);
    if (baseRecord.checksum !== db.record.checksum) throw new StaleSettingsError();
    db.record = { ...db.record, version: db.record.version + 1, checksum: `sha256:mock-${db.record.version + 1}`, lastModified: new Date().toISOString(), content: { entries: clone(content.entries) } };
    console.log('[mock] settings saved, version', db.record.version);
    return { checksum: db.record.checksum, lastModified: db.record.lastModified };
  },
};

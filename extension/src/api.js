// claude.ai internal API (unofficial; observed 2026-10-29). Each page* function
// runs inside a claude.ai tab via runInClaude, so it must be self-contained.
import { runInClaude } from './bridge.js';
import { StaleSettingsError } from './groups.js';

export async function pageGetOrg() {
  try {
    const r = await fetch('/api/organizations', { credentials: 'include' });
    if (!r.ok) return { __error: `Couldn't list organizations (${r.status})`, __status: r.status, __retryAfter: r.headers.get('retry-after') };
    const orgs = await r.json();
    const m = document.cookie.match(/(?:^|; )lastActiveOrg=([^;]+)/);
    const active = m && decodeURIComponent(m[1]);
    const pick = orgs.find(o => o.uuid === active)
      || orgs.find(o => (o.capabilities || []).includes('chat'))
      || orgs[0];
    return pick ? { uuid: pick.uuid, name: pick.name } : { __error: 'No organization found' };
  } catch (e) {
    return { __error: String(e) };
  }
}

export async function pageListChats(org) {
  try {
    const out = [];
    for (let offset = 0; offset < 20000;) {
      const r = await fetch(`/api/organizations/${org}/chat_conversations_v2?limit=100&offset=${offset}&archived=false&consistency=eventual`, { credentials: 'include' });
      if (!r.ok) return { __error: `Couldn't list chats (${r.status})`, __status: r.status, __retryAfter: r.headers.get('retry-after') };
      const j = await r.json();
      if (!j || !Array.isArray(j.data)) return { __error: 'Chat list came back in an unexpected shape' };
      for (const c of j.data) {
        out.push({
          uuid: c.uuid, name: c.name, created_at: c.created_at, updated_at: c.updated_at,
          project_uuid: c.project_uuid || null, project: c.project ? { uuid: c.project.uuid, name: c.project.name } : null,
          is_starred: !!c.is_starred, is_archived: !!c.is_archived, is_temporary: !!c.is_temporary, is_multiplayer: !!c.is_multiplayer,
        });
      }
      if (!j.has_more || j.data.length === 0) break;
      offset += j.data.length;
    }
    return out;
  } catch (e) {
    return { __error: String(e) };
  }
}

export async function pageLastMessageAt(org, uuid) {
  try {
    const r = await fetch(`/api/organizations/${org}/chat_conversations/${uuid}?tree=False&rendering_mode=messages`, { credentials: 'include' });
    if (!r.ok) return { __error: `Couldn't read chat ${uuid} (${r.status})`, __status: r.status, __retryAfter: r.headers.get('retry-after') };
    const j = await r.json();
    let latest = null;
    for (const m of j.chat_messages || []) if (m.created_at && (!latest || m.created_at > latest)) latest = m.created_at;
    return { at: latest };
  } catch (e) {
    return { __error: String(e) };
  }
}

export async function pageListProjects(org) {
  try {
    const out = [];
    for (let offset = 0; offset < 5000;) {
      const r = await fetch(`/api/organizations/${org}/projects?limit=100&offset=${offset}`, { credentials: 'include' });
      if (!r.ok) return { __error: `Couldn't list projects (${r.status})`, __status: r.status, __retryAfter: r.headers.get('retry-after') };
      const j = await r.json();
      if (!Array.isArray(j)) return { __error: 'Project list came back in an unexpected shape' };
      for (const p of j) out.push({ uuid: p.uuid, name: p.name, archived: !!p.archived_at });
      if (j.length < 100) break;
      offset += j.length;
    }
    return out;
  } catch (e) {
    return { __error: String(e) };
  }
}

export async function pageGetUserSettings(org) {
  try {
    const r = await fetch(`/api/claude_code/organizations/${org}/user_settings`, { credentials: 'include' });
    if (!r.ok) return { __error: `Couldn't read sidebar settings (${r.status})`, __status: r.status, __retryAfter: r.headers.get('retry-after') };
    return await r.json();
  } catch (e) {
    return { __error: String(e) };
  }
}

// Write calls, shapes as captured in docs/write-calls.md.

export async function pageRenameChat(org, uuid, name) {
  try {
    const r = await fetch(`/api/organizations/${org}/chat_conversations/${uuid}`, {
      method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (!r.ok) return { __error: `Rename failed (${r.status})`, __status: r.status, __retryAfter: r.headers.get('retry-after') };
    const j = await r.json().catch(() => ({}));
    return { uuid, name: j.name ?? name, updated_at: j.updated_at || null };
  } catch (e) {
    return { __error: String(e) };
  }
}

export async function pageMoveToProject(org, uuids, projectUuid) {
  try {
    const r = await fetch(`/api/organizations/${org}/chat_conversations/move_many`, {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversation_uuids: uuids, project_uuid: projectUuid }),
    });
    if (!r.ok) return { __error: `Project change failed (${r.status})`, __status: r.status, __retryAfter: r.headers.get('retry-after') };
    const j = await r.json();
    if (!j || !Array.isArray(j.moved)) return { __error: 'Project change came back in an unexpected shape' };
    return { moved: j.moved, failed: j.failed || [], reasons: j.failed_reasons || {} };
  } catch (e) {
    return { __error: String(e) };
  }
}

export async function pageSaveUserSettings(org, checksum, entries) {
  try {
    const r = await fetch(`/api/claude_code/organizations/${org}/user_settings`, {
      method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json', 'if-match': checksum },
      body: JSON.stringify({ entries }),
    });
    if (r.status === 409 || r.status === 412) return { __stale: true };
    if (!r.ok) return { __error: `Saving sidebar settings failed (${r.status})`, __status: r.status, __retryAfter: r.headers.get('retry-after') };
    return await r.json();
  } catch (e) {
    return { __error: String(e) };
  }
}

export const api = {
  getOrg: () => runInClaude(pageGetOrg),
  listChats: org => runInClaude(pageListChats, [org.uuid]),
  getLastMessageAt: async (org, uuid) => (await runInClaude(pageLastMessageAt, [org.uuid, uuid])).at,
  listProjects: org => runInClaude(pageListProjects, [org.uuid]),
  getUserSettings: org => runInClaude(pageGetUserSettings, [org.uuid]),
  renameChat: (org, uuid, name) => runInClaude(pageRenameChat, [org.uuid, uuid, name]),
  moveToProject: (org, uuids, projectUuid) => runInClaude(pageMoveToProject, [org.uuid, uuids, projectUuid]),
  async saveUserSettings(org, record, content) {
    const r = await runInClaude(pageSaveUserSettings, [org.uuid, record.checksum, content.entries]);
    if (r && r.__stale) throw new StaleSettingsError();
    return r;
  },
};

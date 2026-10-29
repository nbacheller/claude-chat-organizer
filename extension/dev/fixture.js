// Mock data covering every case the organizer has to handle.
const section = (over) => ({
  v: 2, name: '', order: 0, sortBy: 'recency', ascending: false,
  show: { metadata: false, emptyGroups: false, sideChats: false }, collapsed: false, shown: true, ...over,
});
const P = {
  launch: { uuid: 'p-launch', name: 'Product Launch' },
  ops: { uuid: 'p-ops', name: 'Ops Platform' },
  side1: { uuid: 'p-side1', name: 'Side Project' },
  side2: { uuid: 'p-side2', name: 'Side Project' },
  volunteer: { uuid: 'p-volunteer', name: 'Volunteering' },
  misc: { uuid: 'p-misc', name: 'Misc' },
};
const chat = (uuid, name, created, project, over = {}) => ({
  uuid, name, created_at: created, updated_at: over.updated_at || created, project_uuid: project ? project.uuid : null,
  project: project ? { ...project } : null, is_starred: false, is_archived: false, is_temporary: false, is_multiplayer: false, ...over,
});

export function buildFixture() {
  const chats = [
    chat('c-acme', 'Acme voice agent deck', '2026-10-29T16:57:28Z', P.launch, { updated_at: '2026-10-29T17:12:08Z' }),
    chat('c-managed', 'Managed service expansion', '2026-09-24T17:42:12Z', P.launch, { updated_at: '2026-10-29T15:30:55Z', is_starred: true }),
    chat('c-inventory', 'Inventory integration', '2026-09-10T21:15:15Z', P.ops, { updated_at: '2026-10-29T15:00:48Z', is_starred: true }),
    chat('c-training', 'Solutions training deep dive', '2026-10-27T14:00:00Z', null, { updated_at: '2026-10-28T18:20:00Z' }),
    chat('c-pricing', 'Pricing questions', '2026-10-20T13:00:00Z', null, { updated_at: '2026-10-26T16:00:00Z' }),
    chat('c-side', '10/1/26 - Project API - 3/1/26', '2026-03-01T15:00:00Z', P.side1, { updated_at: '2026-10-01T15:00:00Z' }),
    chat('c-contract', '10/2/26 - Contract review checklist - 8/14/26', '2026-08-14T15:00:00Z', null, { updated_at: '2026-10-21T15:00:00Z' }),
    chat('c-county', 'County business registration - 7/30/26', '2026-07-30T15:00:00Z', null, { updated_at: '2026-08-02T15:00:00Z' }),
    chat('c-shared', 'Shared roadmap review', '2026-09-01T15:00:00Z', P.launch, { updated_at: '2026-10-15T15:00:00Z', is_multiplayer: true }),
    chat('c-orphan', 'Old deal notes', '2026-02-03T15:00:00Z', null, { updated_at: '2026-02-10T15:00:00Z' }),
    chat('c-trip', 'Weekend trip packing list', '2026-09-05T15:00:00Z', P.volunteer, { updated_at: '2026-09-20T15:00:00Z' }),
    chat('c-globex', 'Globex - Managed architecture', '2026-10-10T15:00:00Z', null, { updated_at: '2026-10-12T15:00:00Z' }),
    chat('c-untitled', '', '2026-10-29T18:00:00Z', null, { updated_at: '2026-10-29T18:00:00Z' }),
  ];
  // Newest message per chat; c-globex is missing so it shows as approximate.
  const lastMessageAt = Object.fromEntries(chats.filter(c => c.uuid !== 'c-globex').map(c => [c.uuid, c.updated_at]));
  const store = {
    state: {
      coworkActivityDays: 0,
      customGroups: [
        { id: 'cg-deals', name: 'Client Deals' },
        { id: 'cg-strategy', name: 'Strategy' },
        { id: 'cg-tech', name: 'Technical' },
        { id: 'cg-volunteer', name: 'Volunteering' },
        { id: 'cg-side', name: 'Side Project' },
      ],
      customGroupAssignments: {
        'chat:c-acme': 'cg-deals', 'chat:c-globex': 'cg-deals', 'chat:c-inventory': 'cg-tech',
        'chat:c-side': 'cg-side', 'chat:c-trip': 'cg-volunteer', 'chat:c-orphan': 'cg-gone', 'cowork:x1': 'cg-tech',
      },
      customGroupOrder: {
        'cg-deals': ['chat:c-acme', 'chat:c-globex'], 'cg-tech': ['chat:c-inventory', 'cowork:x1'],
        'cg-side': ['chat:c-side'], 'cg-volunteer': ['chat:c-trip'], 'cg-gone': ['chat:c-orphan'],
      },
      groupByByMode: { cowork: 'custom' },
      pinnedOrder: [],
      recentsStatusFilter: 'active',
      sidebarSections: [
        section({ id: 'pinned', kind: 'pinned', order: 0 }),
        section({ id: 'cg-deals', kind: 'manual', name: 'Client Deals', order: 1, members: ['chat:c-acme', 'chat:c-globex'] }),
        section({ id: 'cg-strategy', kind: 'manual', name: 'Strategy', order: 2, members: [] }),
        section({ id: 'cg-tech', kind: 'manual', name: 'Technical', order: 3, members: ['chat:c-inventory', 'cowork:x1'] }),
        section({ id: 'cg-volunteer', kind: 'manual', name: 'Volunteering', order: 4, members: ['chat:c-trip'] }),
        section({ id: 'cg-side', kind: 'manual', name: 'Side Project', order: 5, members: ['chat:c-side'] }),
      ],
    },
    updatedAt: 1793296358489,
    version: 1,
  };
  const record = {
    userId: 'user-mock', version: 43, lastModified: '2026-10-29T17:52:42Z', checksum: 'sha256:mock',
    content: { entries: { 'ccd/dframe-store': JSON.stringify(store), 'ccd/session-presets': '{"opaque":true}' } },
  };
  return { org: { uuid: 'org-mock', name: 'Mock organization' }, chats, projects: Object.values(P), lastMessageAt, record };
}

// Synthetic user_settings record in the shape observed on claude.ai (2026-10-29).
const section = (over) => ({
  v: 2, name: '', order: 0, sortBy: 'recency', ascending: false,
  show: { metadata: false, emptyGroups: false, sideChats: false },
  collapsed: false, shown: true, ...over,
});

export function storeState() {
  return {
    state: {
      coworkActivityDays: 0,
      customGroups: [
        { id: 'cg-a', name: 'Client Deals' },
        { id: 'cg-b', name: 'Side Project' },
      ],
      customGroupAssignments: {
        'chat:1': 'cg-a',
        'chat:2': 'cg-a',
        'cowork:x': 'cg-b',
        'chat:9': 'cg-gone',
      },
      customGroupOrder: {
        'cg-a': ['chat:1', 'chat:2'],
        'cg-b': ['cowork:x'],
        'cg-gone': ['chat:9'],
      },
      groupByByMode: { cowork: 'custom' },
      pinnedOrder: [],
      navPinnedIds: null,
      recentsStatusFilter: 'active',
      sidebarSections: [
        section({ id: 'pinned', kind: 'pinned', order: 0 }),
        section({ id: 'routines', kind: 'routines', order: 1, collapsed: true, shown: false }),
        section({ id: 'cg-a', kind: 'manual', name: 'Client Deals', order: 2, members: ['chat:1', 'chat:2'] }),
        section({ id: 'cg-b', kind: 'manual', name: 'Side Project', order: 3, members: ['cowork:x'] }),
      ],
    },
    updatedAt: 1793296358489,
    version: 1,
  };
}

export function settingsRecord(store = storeState()) {
  return {
    userId: 'user-1',
    version: 43,
    lastModified: '2026-10-29T17:52:42.207416+00:00',
    checksum: 'sha256:abc',
    content: {
      entries: {
        'ccd/dframe-starred-code': '{"opaque":"starred"}',
        'ccd/dframe-store': JSON.stringify(store),
        'ccd/session-presets': '{"opaque":"presets"}',
      },
    },
  };
}

// Change log for rename and project batches, and the plan to revert one.

const FIELD = { rename: 'name', project: 'project_uuid' };

export function makeBatch(kind, changes) {
  return { id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, at: new Date().toISOString(), changes };
}

// Reverts only chats still holding the value this batch set.
export function planUndo(batch, currentByUuid) {
  const field = FIELD[batch.kind];
  const ops = [];
  for (const c of batch.changes) {
    const chat = currentByUuid.get(c.uuid);
    if (chat && (chat[field] ?? null) === c.after) ops.push({ uuid: c.uuid, value: c.before });
  }
  return ops;
}

// "Last used" = newest message's created_at, cached per chat keyed by updated_at.

export function lastMessageAt(conversation) {
  const msgs = (conversation && conversation.chat_messages) || [];
  let latest = null;
  for (const m of msgs) if (m.created_at && (!latest || m.created_at > latest)) latest = m.created_at;
  return latest;
}

export async function resolveLastUsed(chat, cache, fetchLastAt) {
  const hit = cache[chat.uuid];
  if (hit && hit.updated_at === chat.updated_at) return { at: hit.lastUsed, approx: false };
  let at = null;
  try {
    at = await fetchLastAt(chat.uuid);
  } catch {
    at = null;
  }
  if (!at) return { at: chat.updated_at, approx: true };
  cache[chat.uuid] = { updated_at: chat.updated_at, lastUsed: at };
  return { at, approx: false };
}

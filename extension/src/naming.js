// Chat naming: "M/D/YY - <topic> - M/D/YY" (last activity first, start date last).

const LEAD = /^\d{1,2}\/\d{1,2}\/\d{2} - /;
const TRAIL = / - \d{1,2}\/\d{1,2}\/\d{2}$/;

// Local-time M/D/YY with no leading zeros.
export function formatDate(input) {
  const d = input instanceof Date ? input : new Date(input);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear() % 100).padStart(2, '0')}`;
}

// Removes only the dates this tool adds; each end is handled on its own.
export function stripToolDates(name) {
  let topic = name;
  const lead = LEAD.test(topic);
  if (lead) topic = topic.replace(LEAD, '');
  const trail = TRAIL.test(topic);
  if (trail) topic = topic.replace(TRAIL, '');
  return { topic, lead, trail };
}

// True when a name already carries both of this tool's dates around a topic.
export function hasToolDates(name) {
  if (!name) return false;
  const { topic, lead, trail } = stripToolDates(name);
  return lead && trail && topic.trim() !== '';
}

export function buildName(topic, lastUsed, started) {
  return `${formatDate(lastUsed)} - ${topic} - ${formatDate(started)}`;
}

export function isRenameEligible(chat) {
  return !chat.is_archived && !chat.is_temporary && !chat.is_multiplayer && Boolean(chat.name && chat.name.trim());
}

export function planRename(chat, activity) {
  const base = { uuid: chat.uuid, oldName: chat.name, newName: chat.name, changed: false, partial: false, skip: null, lastUsed: activity ? activity.at : null };
  if (!isRenameEligible(chat)) return { ...base, skip: 'ineligible' };
  if (!activity) return { ...base, skip: 'no-activity' };
  if (activity.approx) return { ...base, skip: 'approx-activity' };
  const { topic, lead, trail } = stripToolDates(chat.name);
  if (!topic.trim()) return { ...base, skip: 'empty-topic' };
  const newName = buildName(topic, activity.at, chat.created_at);
  return { ...base, newName, changed: newName !== chat.name, partial: lead !== trail };
}

// A name this tool already dated (one or both dates) that Refresh names would now change.
export function isStaleName(chat, activity) {
  const { lead, trail } = stripToolDates(chat.name || '');
  return (lead || trail) && planRename(chat, activity).changed;
}

export function orderForRename(plans) {
  return [...plans].sort((a, b) => String(a.lastUsed).localeCompare(String(b.lastUsed)));
}

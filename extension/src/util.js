export const TINT_COUNT = 8;

// Newest first, trimmed to max.
export function capList(list, item, max) {
  return [item, ...list].slice(0, max);
}

// Stable color per group id, from the --tint-N-bg / --tint-N-fg pairs in organizer.css.
export function groupColor(groupId) {
  let h = 0;
  for (const ch of String(groupId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const n = (h % TINT_COUNT) + 1;
  return { bg: `var(--tint-${n}-bg)`, fg: `var(--tint-${n}-fg)` };
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Right-clicking a ticked row acts on every ticked row; any other row acts alone.
export function menuTargets(rowId, selected) {
  return selected.has(rowId) ? [...selected] : [rowId];
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

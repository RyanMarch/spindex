// sourcestats.js - how each outside source has behaved since the page opened (not saved). Shown in the data health panel, so
// "why hasn't this filled in?" has an answer.
const stats = new Map();

export function noteSource(name, ok, detail = '') {
  const entry = stats.get(name) || { ok: 0, failed: 0, last: '' };
  if (ok) entry.ok++;
  else {
    entry.failed++;
    entry.last = detail;
  }
  stats.set(name, entry);
}

export const sourceSnapshot = () => [...stats].map(([name, s]) => ({ name, ...s })).sort((a, b) => a.name.localeCompare(b.name));
export const resetSourceStats = () => stats.clear();

// Discogs slow-downs are the one thing worth remembering between visits: they happen in ordinary use, away from any
// debugger, and the numbers on them show whether the shared proxy address or the app itself ran out of budget.
const SLOWDOWN_KEY = 'spindex_slowdowns';
const SLOWDOWN_KEEP = 10;

// What was being asked for, without the user's name or the release number
export function pathKind(path = '') {
  if (/\/collection\//.test(path)) return 'collection';
  if (/\/releases\//.test(path)) return 'release';
  if (/\/masters\//.test(path)) return 'master';
  if (/\/artists\//.test(path)) return 'artist';
  if (/\/database\/search/.test(path)) return 'search';
  return 'other';
}

export function noteSlowdown(entry, storage = globalThis.localStorage) {
  try {
    const list = readSlowdowns(storage);
    list.unshift({ at: Date.now(), ...entry });
    storage.setItem(SLOWDOWN_KEY, JSON.stringify(list.slice(0, SLOWDOWN_KEEP)));
  } catch {
    // Private mode or full storage: the log is a convenience
  }
}

export function readSlowdowns(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage.getItem(SLOWDOWN_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// "12 of 60 used" when Discogs said, otherwise what we know
export function describeSlowdown({ kind = 'other', via = 'proxy', used = null, limit = null, retryAfter = null }) {
  const budget = used == null || limit == null
    ? 'no budget reported'
    : used > limit ? `${used} counted, limit ${limit}` : `${used} of ${limit} used`;
  return `${kind}${via === 'direct' ? ' (direct)' : ''}, ${budget}${retryAfter ? `, wait ${retryAfter}s` : ''}`;
}

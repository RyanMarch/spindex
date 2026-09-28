// welcome.js - the words for the first-run screen and for the first time a collection is brought in. Pure, for testing.

export const WELCOME = {
  title: 'Explore your albums in new ways',
  body: 'Spindex turns your record collection into a crate you can flip through. Connect with Discogs to get started.',
};

// "23 of 51 records", or while the total is unknown, how many so far
export function progressLabel({ count = 0, total = null, page = 1, totalPages = 1 } = {}) {
  const n = (v) => Number(v).toLocaleString('en-US');
  if (total && total >= count) return `${n(count)} of ${n(total)} ${total === 1 ? 'record' : 'records'}`;
  if (totalPages > 1) return `Page ${page} of ${totalPages}`;
  return count ? `${n(count)} ${count === 1 ? 'record' : 'records'} so far` : 'Getting started';
}

// How far along, 0 to 1, for the bar. Unknown totals show a little movement rather than nothing.
export function progressFraction({ count = 0, total = null, page = 1, totalPages = 1 } = {}) {
  if (total && total > 0) return Math.min(1, count / total);
  if (totalPages > 1) return Math.min(1, page / totalPages);
  return count ? 0.5 : 0.05;
}

// The most recent covers to show, without repeats, capped so the row stays a row
export function recentCovers(records, existing = [], cap = 14) {
  const seen = new Set(existing.map((c) => c.id));
  const added = (records || []).filter((r) => r?.artwork?.thumbnail && !seen.has(r.id)).map((r) => ({ id: r.id, url: r.artwork.thumbnail }));
  return [...existing, ...added].slice(-cap);
}

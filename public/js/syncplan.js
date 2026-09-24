// syncplan.js - deciding how much of the Discogs collection a sync has to read. The collection is fetched newest
// first, so when nothing else has changed a sync can stop at the first page that shows records we already have.

const FULL_SYNC_EVERY_DAYS = 14;
const CHECK_EVERY_HOURS = 6; // how stale the crate may get before opening the app checks for new records

// storedTotal: how many items Discogs reported after the last sync (null if we've never synced).
export function needsFullSync({ storedTotal, lastFullAt }, now = Date.now(), forced = false) {
  if (forced || storedTotal == null || !lastFullAt) return true;
  return now - lastFullAt > FULL_SYNC_EVERY_DAYS * 86400000;
}

// After reading a page: stop if it reached records we already have AND the numbers add up, meaning Discogs' total is
// exactly the old total plus what's new. A removed record, a second copy of a release we own, or anything else that
// doesn't fit shows up as a mismatch, and the sync keeps reading instead of guessing.
export function canStopEarly({ pageHasKnown, storedTotal, total, newCount }) {
  return Boolean(pageHasKnown) && storedTotal != null && total === storedTotal + newCount;
}

const key = (username) => `spindex_sync_${String(username).toLowerCase()}`;

const EMPTY_META = { storedTotal: null, lastFullAt: 0, lastCheckedAt: 0 };

export function readSyncMeta(username, storage = globalThis.localStorage) {
  try {
    const meta = JSON.parse(storage.getItem(key(username)) || 'null');
    return meta && typeof meta === 'object'
      ? { storedTotal: meta.total ?? null, lastFullAt: meta.lastFullAt || 0, lastCheckedAt: meta.lastCheckedAt || 0 }
      : { ...EMPTY_META };
  } catch {
    return { ...EMPTY_META };
  }
}

export function writeSyncMeta(username, meta, storage = globalThis.localStorage) {
  try {
    storage.setItem(key(username), JSON.stringify({ total: meta.storedTotal, lastFullAt: meta.lastFullAt, lastCheckedAt: meta.lastCheckedAt || 0 }));
  } catch {
    // Private mode or full storage: the next sync just reads everything
  }
}

// Records in the crate that are no longer in the Discogs collection. Only ever answered after a complete read, and
// never on a result that looks wrong: an empty answer, or a page count that doesn't match the total Discogs reported,
// deletes nothing.
export function removedRecordIds(existingRecords, fetchedIds, { total, fetchedCount }) {
  if (fetchedCount === 0 || total == null || fetchedCount !== total) return [];
  const fetched = new Set(fetchedIds);
  return existingRecords
    .filter((r) => String(r.id).startsWith('discogs_') && !String(r.id).startsWith('discogs_mock_') && !fetched.has(r.id))
    .map((r) => r.id);
}

// Opening the app checks for new records when it has been a while (or never), so nobody has to press a button
export function needsAutoSync({ lastCheckedAt }, now = Date.now()) {
  return !lastCheckedAt || now - lastCheckedAt > CHECK_EVERY_HOURS * 3600000;
}

// "just now", "5 minutes ago", "2 hours ago", "3 days ago"
export function timeAgo(then, now = Date.now()) {
  if (!then) return 'never';
  const minutes = Math.max(0, Math.floor((now - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

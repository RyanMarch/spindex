// syncplan.js - deciding how much of the Discogs collection a sync has to read. The collection is fetched newest
// first, so when nothing else has changed a sync can stop at the first page that shows records we already have.

const FULL_SYNC_EVERY_DAYS = 14;

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

export function readSyncMeta(username, storage = globalThis.localStorage) {
  try {
    const meta = JSON.parse(storage.getItem(key(username)) || 'null');
    return meta && typeof meta === 'object' ? { storedTotal: meta.total ?? null, lastFullAt: meta.lastFullAt || 0 } : { storedTotal: null, lastFullAt: 0 };
  } catch {
    return { storedTotal: null, lastFullAt: 0 };
  }
}

export function writeSyncMeta(username, meta, storage = globalThis.localStorage) {
  try {
    storage.setItem(key(username), JSON.stringify({ total: meta.storedTotal, lastFullAt: meta.lastFullAt }));
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

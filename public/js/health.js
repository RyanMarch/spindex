// health.js - a plain account of what the crate knows about itself and what is still being worked out. Pure functions over the
// records already in this browser, so the panel in Settings (and the tests) need no network.
import { isCustomRelease } from './values.js';
import { needsDeezerArt, needsItunesArt, needsDetails, needsArtVerification, needsArtRecheck, needsMasterTitleArt } from './sync.js';

const isDemo = (r) => String(r.id).startsWith('discogs_mock_');

export function computeHealth(records) {
  const real = (records || []).filter((r) => !isDemo(r));
  const count = (fn) => real.filter(fn).length;

  const withMaster = real.filter((r) => r.masterId);
  const opened = real.filter((r) => r.context?.backCover !== undefined);

  return {
    total: real.length,
    covers: {
      cleaner: count((r) => ['deezer', 'itunes'].includes(r.artwork?.source)),
      discogs: count((r) => r.artwork?.source === 'discogs'),
      pinned: count((r) => r.artworkLocked),
      offered: count((r) => r.artwork?.source === 'discogs' && r.artCandidate && !r.artworkLocked),
    },
    details: { have: count((r) => r.details), total: count((r) => r.discogsId), custom: count(isCustomRelease) },
    years: { resolved: withMaster.filter((r) => r.masterYear != null || r.masterChecked).length, total: withMaster.length },
    backCovers: { found: opened.filter((r) => r.context.backCover).length, none: opened.filter((r) => !r.context.backCover).length, opened: opened.length },
    pending: {
      art: count((r) => needsDeezerArt(r) || needsItunesArt(r) || needsMasterTitleArt(r) || needsArtVerification(r) || needsArtRecheck(r)),
      details: count(needsDetails),
    },
  };
}

// Turn what the browser reports about storage into words
export function describeStorage({ usage, quota, persisted } = {}) {
  const megabytes = (n) => `${(n / (1024 * 1024)).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
  return {
    used: Number.isFinite(usage) ? megabytes(usage) : 'unknown',
    quota: Number.isFinite(quota) && quota > 0 ? megabytes(quota) : 'unknown',
    persisted: persisted === true ? 'Protected from automatic clean-up' : persisted === false ? 'Not protected: the browser may clear it if space runs short' : 'Unknown',
  };
}

// One line for the collapsed panel: is anything still being worked out?
export function healthSummary(h) {
  if (h.total === 0) return 'Nothing to report yet';
  const parts = [];
  if (h.pending.details) parts.push(`${h.pending.details} details`);
  if (h.pending.art) parts.push(`${h.pending.art} covers`);
  return parts.length ? `Filling in ${parts.join(' and ')}` : 'All caught up';
}

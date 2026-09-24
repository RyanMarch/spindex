// share.js - the read-only link, from the page's side: the address form, what is sent, and the calls to the server.

// /s/<20 letters and digits> and anything beneath it (an album inside that crate)
export function shareIdFromPath(pathname) {
  const m = String(pathname || '').match(/^\/s\/([a-z0-9]{20})(?:\/|$)/);
  return m ? m[1] : null;
}

// Just enough to browse the crate. The server trims it again and refuses the rest; the point here is not to send
// notes, conditions or the gathered liner notes in the first place.
export function buildSnapshot(records) {
  return (records || [])
    .filter((r) => r && /^discogs_\d+$/.test(String(r.id)))
    .map((r) => {
      const out = {
        id: r.id, title: r.title, artist: r.artist, sortArtist: r.sortArtist,
        year: r.year, masterYear: r.masterYear, originalYear: r.originalYear, pressingYear: r.pressingYear,
        primaryGenre: r.primaryGenre, genres: r.genres, styles: r.styles, dateAdded: r.dateAdded,
        discogsId: r.discogsId, masterId: r.masterId,
        artwork: r.artwork ? { highRes: r.artwork.highRes, thumbnail: r.artwork.thumbnail, source: r.artwork.source } : {},
        tracklist: (r.tracklist || []).map((t) => ({ position: t.position, title: t.title, duration: t.duration })),
      };
      if (r.details?.formats) out.details = { status: r.details.status, formats: r.details.formats };
      return out;
    });
}

const call = async (path, init) => {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Sharing failed (${res.status})`);
  return body;
};

export const fetchShareStatus = () => call('/api/share').catch(() => ({ available: false }));

export const publishShare = (records) => call('/api/share', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ records: buildSnapshot(records) }),
});

export const stopSharing = () => call('/api/share', { method: 'DELETE' });

// The snapshot behind a link, or null when the link is gone
export async function loadShare(id) {
  const res = await fetch(`/api/share/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not open this crate (${res.status})`);
  return res.json();
}

// "2 minutes ago" style, reusing the wording used for sync
export const SHARE_REPUBLISH_AFTER_MS = 24 * 60 * 60 * 1000;
export function shareIsStale(updatedAt, now = Date.now()) {
  const t = Date.parse(updatedAt || '');
  return !t || now - t > SHARE_REPUBLISH_AFTER_MS;
}

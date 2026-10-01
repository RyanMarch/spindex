// track-artists.js - who is on each track. On an ordinary album Discogs leaves the tracks' artists blank (they are the album's
// artist). On a compilation, a split, a soundtrack or a tribute it names them track by track, with a "join" between several
// ("The Lonely Island" + "," + "Michael Bolton"). Pure functions, so they're easy to test.

const clean = (name) => String(name || '').replace(/\s\(\d+\)$/, '').trim(); // "Nirvana (2)" is Discogs telling two Nirvanas apart
const norm = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const isVarious = (name) => /^various(\s+artists)?$/i.test(String(name || '').trim());

// The name as it is printed on the sleeve (Discogs' "anv") when there is one
const printed = (artist) => clean(artist?.anv || artist?.name);

// "The Lonely Island" + "," + "Michael Bolton" -> "The Lonely Island, Michael Bolton"; "A" + "&" + "B" -> "A & B"
export function artistCredit(artists) {
  const list = (artists || []).filter((a) => printed(a));
  return list.map((a, i) => {
    if (i === list.length - 1) return printed(a);
    const join = String(a.join || '').trim();
    return `${printed(a)}${join === ',' || !join ? ', ' : ` ${join} `}`;
  }).join('').trim();
}

// Discogs' tracklist -> { "A1": { names: ["Howie Day"], credit: "Howie Day" }, ... }, only for the tracks that name an artist.
// Positions are worked out the same way as mapDiscogsTracklist does, so the two line up.
export function mapTrackArtists(list) {
  const out = {};
  (list || []).filter((t) => (!t.type_ || t.type_ === 'track') && t.title).forEach((t, idx) => {
    const names = (t.artists || []).map(printed).filter(Boolean);
    if (names.length) out[t.position || String(idx + 1)] = { names, credit: artistCredit(t.artists) };
  });
  return out;
}

const entry = (record, track) => record?.details?.trackArtists?.[track?.position] || null;

// The artist line for one track ("Howie Day"), or '' when the track doesn't name one
export const trackCredit = (record, track) => entry(record, track)?.credit || '';

// Everyone named on the track, for searching
export const trackNames = (record, track) => entry(record, track)?.names || [];

// The track's first artist, for looking up lyrics: a compilation's own artist is "Various", which finds nothing
export const lyricsArtist = (record, track) => entry(record, track)?.names?.[0] || record?.artist || '';

// Every artist on the record: those it is billed to (never "Various") and those credited on its tracks
export function artistsOnRecord(record) {
  const seen = new Map();
  const add = (name) => {
    const n = clean(name);
    if (n && !isVarious(n) && !seen.has(norm(n))) seen.set(norm(n), n);
  };
  const billed = record?.details?.artists || [];
  if (billed.length) billed.forEach((a) => add(a.name));
  else add(record?.artist);
  for (const e of Object.values(record?.details?.trackArtists || {})) e.names.forEach(add);
  return [...seen.values()];
}

// Whether the tracklist should print an artist under each title. It should when the tracks are by different artists (a
// compilation, a split) or by someone the album isn't billed to; it shouldn't when every track just repeats the album's
// own artist, which Discogs sometimes spells out.
export function showTrackArtists(record) {
  const entries = Object.values(record?.details?.trackArtists || {});
  if (!entries.length) return false;
  const credits = new Set(entries.map((e) => norm(e.names.join(' '))));
  if (credits.size >= 2) return true;
  const billed = new Set([record.artist, ...(record.details?.artists || []).map((a) => a.name)].map(norm));
  return !entries[0].names.every((n) => billed.has(norm(n)));
}

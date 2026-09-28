// share.js - the read-only link. A snapshot of the collection (only what is needed to browse it) is stored under a
// random, unguessable address; anyone with the address can open it, and only its owner can replace or remove it.
// Notes, conditions and everything else personal are never part of the snapshot.

export const SHARE_ID = /^(?:[a-z0-9]{20}|[a-z0-9]+(?:-[a-z0-9]+){2,4})$/;
export const MAX_BODY_BYTES = 8_000_000;
export const MAX_RECORDS = 5000;

const ADJECTIVES = [
  'analog', 'vintage', 'deep', 'dusty', 'golden', 'heavy', 'mellow', 'mono',
  'pristine', 'rare', 'sonic', 'spinning', 'stereo', 'warm', 'velvet', 'grooved',
  'classic', 'electric', 'acoustic', 'smooth', 'sweet', 'crisp', 'pure', 'fancy', 'fun',
  'spinning', 'jamming', 'electric', 'acoustic', 'soulful', 'funky', 'groovy',
  'chill', 'fresh', 'hot', 'cool', 'loud', 'rockin', 'fun', 'zesty', 'rad', 'secret',
  'rare', 'magic', 'lost', 'hidden',

];

const NOUNS = [
  'crate', 'groove', 'needle', 'pressing', 'record', 'sleeve', 'spindle', 'stylus',
  'turntable', 'vinyl', 'wax', 'jacket', 'platter', 'tonearm', 'matrix', 'runout',
  'label', 'track', 'album', 'party', 'collection', 'mix', 'session', 'single',
  'set', 'jam', 'dance', 'grooves', 'hits', 'stacks', 'crate', 'tracks', 'tracklist',
  'vibes', 'beats', 'bass', 'sleeve', 'guitar', 'bassline', 'kick', 'drum', 'snare',
  'strings', 'keys', 'synth', 'sampler', 'mixer', 'fader', 'reverb', 'delay', 'echo',
  'loop', 'headphones', 'speakers', 'amps', 'deck', 'remix',
];

export function newShareId() {
  const randByte = (max) => crypto.getRandomValues(new Uint8Array(1))[0] % max;
  const adj = ADJECTIVES[randByte(ADJECTIVES.length)];
  const noun = NOUNS[randByte(NOUNS.length)];
  const code = [...crypto.getRandomValues(new Uint8Array(2))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${adj}-${noun}-${code}`;
}

const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const year = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1000 && n <= 3000 ? n : 0;
};
const list = (value, max, each) => (Array.isArray(value) ? value.slice(0, max).map((v) => str(v, each)).filter(Boolean) : []);
const httpsUrl = (value) => (typeof value === 'string' && /^https:\/\/[^\s]{1,580}$/.test(value) ? value : '');

// Only these fields survive, each trimmed to a sensible size. Anything else a page sent is dropped.
export function cleanRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 40);
  const title = str(raw.title, 200).trim();
  const artist = str(raw.artist, 200).trim();
  if (!/^discogs_\d+$/.test(id) || !title || !artist) return null; // the demo crate and malformed entries are not shared

  const out = { id, title, artist };
  const sortArtist = str(raw.sortArtist, 200);
  if (sortArtist) out.sortArtist = sortArtist;
  for (const key of ['year', 'masterYear', 'originalYear', 'pressingYear']) if (year(raw[key])) out[key] = year(raw[key]);
  const primaryGenre = str(raw.primaryGenre, 60);
  if (primaryGenre) out.primaryGenre = primaryGenre;
  out.genres = list(raw.genres, 12, 60);
  out.styles = list(raw.styles, 12, 60);
  const dateAdded = str(raw.dateAdded, 40);
  if (dateAdded) out.dateAdded = dateAdded;
  if (Number.isInteger(raw.discogsId)) out.discogsId = raw.discogsId;
  if (Number.isInteger(raw.masterId)) out.masterId = raw.masterId;

  const art = raw.artwork || {};
  out.artwork = { highRes: httpsUrl(art.highRes), thumbnail: httpsUrl(art.thumbnail) };
  if (art.source) out.artwork.source = str(art.source, 20);
  if (art.locked) out.artwork.locked = true;

  out.tracklist = (Array.isArray(raw.tracklist) ? raw.tracklist.slice(0, 150) : []).map((t) => ({
    position: str(t?.position, 12),
    title: str(t?.title, 200),
    duration: str(t?.duration, 12),
  })).filter((t) => t.title);

  const formats = raw.details?.formats;
  if (Array.isArray(formats) && formats.length) {
    out.details = {
      status: str(raw.details.status, 20),
      formats: formats.slice(0, 6).map((f) => ({
        name: str(f?.name, 40),
        qty: str(String(f?.qty ?? '1'), 6),
        descriptions: list(f?.descriptions, 10, 40),
        text: str(f?.text, 120),
      })),
    };
  }
  return out;
}

export function cleanRecords(list_) {
  if (!Array.isArray(list_)) return [];
  return list_.slice(0, MAX_RECORDS).map(cleanRecord).filter(Boolean);
}

export const ownerKey = (username) => `owner:${String(username).toLowerCase()}`;
export const shareKey = (id) => `share:${id}`;

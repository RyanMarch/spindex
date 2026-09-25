// Crate search: a record matches on its title or artist, or on the name of one of its tracks.

export function fold(text) {
  return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function searchWords(query) {
  return fold(query).split(/\s+/).filter(Boolean);
}

// Every word has to be found together: in the album's title and artist, or in the artist plus a single track's title.
// Returns null for no match, { track: null } for an album match, or { track, index } when only a track matched.
export function matchRecord(record, words) {
  if (!words.length) return { track: null };
  const has = (haystack) => words.every((word) => haystack.includes(word));
  const artist = fold(record.artist);
  if (has(`${fold(record.title)} ${artist}`)) return { track: null };
  const tracks = Array.isArray(record.tracklist) ? record.tracklist : [];
  for (let index = 0; index < tracks.length; index += 1) {
    const title = tracks[index]?.title;
    if (title && has(`${fold(title)} ${artist}`)) return { track: title, index };
  }
  return null;
}

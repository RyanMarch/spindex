// deezer.js - matching Deezer's search results to an album we own, kept apart from the request handler so it can be tested

export const normalize = (text) => String(text || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ') // "(Deluxe Edition)", "[Remastered]"
  .replace(/^the\s+/, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export const isVarious = (artist) => /^various(\s+artists)?$/i.test(String(artist || '').trim());

// The album's Deezer page, only when artist and title both match; otherwise null
export function pickDeezerAlbum(albums, artist, title) {
  const wantedTitle = normalize(title);
  if (!wantedTitle) return null;
  const wantedArtist = normalize(artist);
  const various = isVarious(artist);
  const hit = (albums || []).find((album) => normalize(album.title) === wantedTitle
    && (various || normalize(album.artist?.name) === wantedArtist));
  return hit?.link || null;
}

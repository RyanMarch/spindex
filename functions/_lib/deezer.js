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

// The album's Deezer entry, only when artist and title both match; otherwise null
export function matchDeezerAlbum(albums, artist, title) {
  const wantedTitle = normalize(title);
  if (!wantedTitle) return null;
  const wantedArtist = normalize(artist);
  const various = isVarious(artist);
  return (albums || []).find((album) => normalize(album.title) === wantedTitle
    && (various || normalize(album.artist?.name) === wantedArtist)) || null;
}

// Its page, for the "Listen" links
export const pickDeezerAlbum = (albums, artist, title) => matchDeezerAlbum(albums, artist, title)?.link || null;

// Its square cover art (1000px), for records whose Discogs image is a photograph
export const pickDeezerCover = (albums, artist, title) => {
  const album = matchDeezerAlbum(albums, artist, title);
  return album?.cover_xl || album?.cover_big || null;
};

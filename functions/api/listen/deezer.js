// GET /api/listen/deezer?artist=...&title=...
// Finds the album on Deezer and returns its page, but only when the artist and title really match. Deezer's public
// API is keyless but doesn't allow browser requests, so the lookup happens here. Returns { url: null, cover: null } for no match; cover is the square artwork.
import { json } from '../../_lib/http.js';
import { isVarious, pickDeezerAlbum, pickDeezerCover } from '../../_lib/deezer.js';

export async function onRequestGet({ request }) {
  const params = new URL(request.url).searchParams;
  const artist = (params.get('artist') || '').slice(0, 200);
  const title = (params.get('title') || '').slice(0, 200);
  if (!title) return json({ url: null, cover: null });

  const query = isVarious(artist) ? `album:"${title}"` : `artist:"${artist}" album:"${title}"`;

  let data;
  try {
    const res = await fetch(`https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=10`);
    if (!res.ok) return json({ url: null, error: true }, 502);
    data = await res.json();
  } catch {
    return json({ url: null, error: true }, 502);
  }

  const link = pickDeezerAlbum(data?.data, artist, title);

  return json({ url: link, cover: pickDeezerCover(data?.data, artist, title) }, 200, { 'Cache-Control': 'public, max-age=86400' });
}

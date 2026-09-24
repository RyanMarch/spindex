// GET /api/listen/deezer?artist=...&title=...
// Finds the album on Deezer and returns its page, but only when the artist and title really match. Deezer's public
// API is keyless but doesn't allow browser requests, so the lookup happens here. Returns { url: null, cover: null } for no match; cover is the square artwork.
import { json } from '../../_lib/http.js';
import { isVarious, pickDeezerAlbum, pickDeezerCover } from '../../_lib/deezer.js';
import { cacheKey } from '../../_lib/cache.js';

const DAY = 86400;

export async function onRequestGet({ request, waitUntil }) {
  const params = new URL(request.url).searchParams;
  const artist = (params.get('artist') || '').slice(0, 200);
  const title = (params.get('title') || '').slice(0, 200);
  if (!title) return json({ url: null, cover: null });

  // One answer per album, shared by everyone: a match is kept a week, a "no match" a day
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = cacheKey(`/deezer/${encodeURIComponent(artist.toLowerCase())}/${encodeURIComponent(title.toLowerCase())}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return json(await hit.json(), 200, { 'Cache-Control': 'public, max-age=86400', 'X-Spindex-Cache': 'HIT' });
  }

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
  const answer = { url: link, cover: pickDeezerCover(data?.data, artist, title) };

  if (cache) {
    const stored = new Response(JSON.stringify(answer), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${link ? 7 * DAY : DAY}` } });
    const put = cache.put(key, stored).catch(() => {});
    if (waitUntil) waitUntil(put);
    else await put;
  }
  return json(answer, 200, { 'Cache-Control': 'public, max-age=86400', 'X-Spindex-Cache': 'MISS' });
}

// GET /api/listen/deezer?artist=...&title=...
// Finds the album on Deezer and returns its page, but only when the artist and title really match. Deezer's public
// API is keyless but doesn't allow browser requests, so the lookup happens here. Returns { url: null } for no match.
import { json } from '../../_lib/http.js';

const normalize = (text) => String(text || '')
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ') // "(Deluxe Edition)", "[Remastered]"
  .replace(/^the\s+/, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export async function onRequestGet({ request }) {
  const params = new URL(request.url).searchParams;
  const artist = (params.get('artist') || '').slice(0, 200);
  const title = (params.get('title') || '').slice(0, 200);
  if (!title) return json({ url: null });

  const various = /^various(\s+artists)?$/i.test(artist.trim());
  const query = various ? `album:"${title}"` : `artist:"${artist}" album:"${title}"`;

  let data;
  try {
    const res = await fetch(`https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=10`);
    if (!res.ok) return json({ url: null, error: true }, 502);
    data = await res.json();
  } catch {
    return json({ url: null, error: true }, 502);
  }

  const wantedTitle = normalize(title);
  const wantedArtist = normalize(artist);
  const hit = (data?.data || []).find((album) => normalize(album.title) === wantedTitle
    && (various || normalize(album.artist?.name) === wantedArtist));

  return json({ url: hit?.link || null }, 200, { 'Cache-Control': 'public, max-age=86400' });
}

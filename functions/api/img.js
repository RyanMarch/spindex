// GET /api/img?url=<https image url> - hands a Discogs thumbnail to the page from our own address. Browsers won't let a
// page read the pixels of an image from another site unless that site allows it, and Discogs doesn't; from our own
// address the page can. It is only used to compare a Discogs cover with a candidate cover before swapping artwork.
// Nothing is stored here, and it is not an open proxy: one host, images only, GET only, and only from pages on this site.
import { json } from '../_lib/http.js';
import { USER_AGENT } from '../_lib/oauth.js';
import { sameSite } from './ext.js';

const HOSTS = new Set(['i.discogs.com']);
const MAX_BYTES = 3 * 1024 * 1024;

export function allowedImage(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || !HOSTS.has(url.host)) return null;
  return url;
}

export async function onRequestGet({ request }) {
  const marked = { 'X-Spindex-Proxy': '1' };
  if (!sameSite(request)) return json({ error: 'Not available.' }, 403, marked);

  const url = allowedImage(new URL(request.url).searchParams.get('url'));
  if (!url) return json({ error: 'That image source is not available.' }, 403, marked);

  let upstream;
  try {
    upstream = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' } });
  } catch {
    return json({ error: 'Could not reach the image.' }, 502, marked);
  }
  if (!upstream.ok) return json({ error: `The image answered ${upstream.status}.` }, upstream.status === 404 ? 404 : 502, marked);

  const type = upstream.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return json({ error: 'Not an image.' }, 502, marked);

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return json({ error: 'Too large.' }, 413, marked);

  return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400', ...marked } });
}

export async function onRequest() {
  return json({ error: 'Not supported.' }, 405, { 'X-Spindex-Proxy': '1' });
}

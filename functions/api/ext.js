// GET /api/ext?url=<https url> - a caching front for the public data sources the album page reads (Wikipedia, Wikidata,
// Commons, MusicBrainz, the Cover Art Archive). Answers are the same for everyone, so once anyone has fetched one, later
// requests (a second device, a re-open after clearing storage) come from Cloudflare's cache instead of the source.
// Requests also go out with a proper User-Agent, which MusicBrainz and Wikimedia both ask for.
//
// It is not an open proxy: only these hosts and these paths, GET only, and only from pages on this site.
import { json } from '../_lib/http.js';
import { USER_AGENT } from '../_lib/oauth.js';
import { cacheKey } from '../_lib/cache.js';

const DAY = 86400;
const MAX_BYTES = 2 * 1024 * 1024;
const NOT_FOUND_TTL = DAY; // "no such page" answers are cached briefly, so a page created later is picked up

export const SOURCES = {
  'en.wikipedia.org': { ttl: 7 * DAY, paths: [/^\/w\/api\.php$/, /^\/w\/rest\.php\/v1\/search\/title$/, /^\/api\/rest_v1\/page\/summary\/[^/]+$/] },
  'www.wikidata.org': { ttl: 7 * DAY, paths: [/^\/w\/api\.php$/] },
  'query.wikidata.org': { ttl: 30 * DAY, paths: [/^\/sparql$/] },
  'commons.wikimedia.org': { ttl: 30 * DAY, paths: [/^\/w\/api\.php$/] },
  'musicbrainz.org': { ttl: 30 * DAY, paths: [/^\/ws\/2\/(release-group|release)\/?$/] },
  'coverartarchive.org': { ttl: 30 * DAY, paths: [/^\/release\/[0-9a-f-]{36}$/] },
};

// The upstream URL if this proxy will fetch it, else null
export function allowedSource(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const source = SOURCES[url.host];
  if (url.protocol !== 'https:' || url.username || url.password || !source) return null;
  return source.paths.some((re) => re.test(url.pathname)) ? { url, ttl: source.ttl } : null;
}

// Only pages on this site may use it
export function sameSite(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site) return site === 'same-origin' || site === 'none';
  const from = request.headers.get('Origin') || request.headers.get('Referer');
  try {
    return Boolean(from) && new URL(from).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

const reply = (body, status, extra = {}) => new Response(body, {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300', 'X-Spindex-Proxy': '1', ...extra },
});

export async function onRequestGet({ request, waitUntil }) {
  if (!sameSite(request)) return json({ error: 'Not available.' }, 403, { 'X-Spindex-Proxy': '1' });

  const wanted = allowedSource(new URL(request.url).searchParams.get('url'));
  if (!wanted) return json({ error: 'That source is not available.' }, 403, { 'X-Spindex-Proxy': '1' });

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = cacheKey(`/ext/${wanted.url.host}${wanted.url.pathname}${wanted.url.search}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return reply(hit.body, hit.status, { 'X-Spindex-Cache': 'HIT' });
  }

  let upstream;
  try {
    upstream = await fetch(wanted.url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, redirect: 'follow' });
  } catch {
    return reply('{"error":"Could not reach the source."}', 502);
  }

  // Throttling and outages are passed on and never remembered
  if (!upstream.ok && upstream.status !== 404) {
    const extra = upstream.headers.get('retry-after') ? { 'Retry-After': upstream.headers.get('retry-after') } : {};
    return reply(JSON.stringify({ error: `The source answered ${upstream.status}.` }), upstream.status === 429 || upstream.status === 503 ? upstream.status : 502, extra);
  }

  const body = await upstream.text();
  if (body.length > MAX_BYTES) return reply('{"error":"Too large."}', 413);

  if (cache) {
    const ttl = upstream.ok ? wanted.ttl : NOT_FOUND_TTL;
    const stored = new Response(body, { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } });
    const put = cache.put(key, stored).catch(() => {});
    if (waitUntil) waitUntil(put);
    else await put;
  }
  return reply(body, upstream.status, { 'X-Spindex-Cache': 'MISS' });
}

export async function onRequest() {
  return json({ error: 'Not supported.' }, 405, { 'X-Spindex-Proxy': '1' });
}

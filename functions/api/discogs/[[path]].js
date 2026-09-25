// GET /api/discogs/<discogs path> - a read-only proxy that signs requests with the signed-in user's OAuth token.
import { configured, apiRequest } from '../../_lib/oauth.js';
import { readSession, clearCookie, SESSION_COOKIE } from '../../_lib/session.js';
import { allowedUpstream } from '../../_lib/proxy.js';
import { json } from '../../_lib/http.js';
import { cacheablePath, cacheKey, ttlSeconds, stripMarketplace } from '../../_lib/cache.js';

// Headers worth passing back: rate-limit accounting lets the app pace itself
const PASS_THROUGH = ['content-type', 'retry-after', 'x-discogs-ratelimit', 'x-discogs-ratelimit-used', 'x-discogs-ratelimit-remaining'];

export async function onRequestGet({ request, env, params, waitUntil }) {
  if (!configured(env)) return json({ error: 'Discogs is not configured on this server.' }, 503);

  const session = await readSession(request, env);
  if (!session) return json({ error: 'Not connected to Discogs.' }, 401);

  const segments = Array.isArray(params.path) ? params.path : [params.path];
  const upstreamPath = allowedUpstream(segments.join('/'), new URL(request.url).searchParams, session);
  if (!upstreamPath) return json({ error: 'That Discogs endpoint is not available.' }, 403);

  // Public pages (releases, masters, artists) are shared through Cloudflare's edge cache. This sits after the
  // session check, so only signed-in people can read from it.
  const cachePath = cacheablePath(upstreamPath);
  const ttl = ttlSeconds(env);
  const cache = cachePath && ttl > 0 && typeof caches !== 'undefined' ? caches.default : null;
  // An optional KV namespace (DISCOGS_DATA) keeps answers for the long term and across data centres; the edge cache
  // alone is per-location and can be emptied at any time.
  const store = cachePath && ttl > 0 ? env.DISCOGS_DATA : null;
  const kvKey = cachePath ? `discogs:${cachePath}` : null;
  if (cache) {
    const hit = await cache.match(cacheKey(cachePath));
    if (hit) {
      return new Response(hit.body, {
        status: 200,
        headers: { 'Content-Type': hit.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'private, no-store', 'X-Spindex-Cache': 'HIT' },
      });
    }
  }
  if (store) {
    const saved = await store.get(kvKey).catch(() => null);
    if (saved) {
      return new Response(saved, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Spindex-Cache': 'HIT' } });
    }
  }

  let upstream;
  try {
    upstream = await apiRequest(env, session, upstreamPath);
  } catch {
    return json({ error: 'Could not reach Discogs.' }, 502);
  }

  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Discogs no longer accepts this token (the user revoked the app): drop the session so the UI can reconnect
  if (upstream.status === 401) headers.append('Set-Cookie', clearCookie(request, SESSION_COOKIE));

  if ((cache || store) && upstream.ok) {
    headers.set('X-Spindex-Cache', 'MISS');
    const body = stripMarketplace(await upstream.text());
    const contentType = upstream.headers.get('content-type') || 'application/json';
    const stored = new Response(body, { status: 200, headers: { 'Content-Type': contentType, 'Cache-Control': `public, max-age=${ttl}` } });
    const put = Promise.all([
      cache ? cache.put(cacheKey(cachePath), stored).catch(() => {}) : null,
      store ? store.put(kvKey, body, { expirationTtl: Math.max(60, ttl) }).catch(() => {}) : null,
    ]);
    if (waitUntil) waitUntil(put);
    else await put;
    return new Response(body, { status: 200, headers });
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

// Everything else on this path is off limits
export async function onRequest({ request }) {
  return json({ error: `${request.method} is not supported.` }, 405);
}

// GET /api/discogs/<discogs path> - a read-only proxy that signs requests with the signed-in user's OAuth token.
import { configured, apiRequest } from '../../_lib/oauth.js';
import { readSession, clearCookie, SESSION_COOKIE } from '../../_lib/session.js';
import { allowedUpstream } from '../../_lib/proxy.js';
import { json } from '../../_lib/http.js';

// Headers worth passing back: rate-limit accounting lets the app pace itself
const PASS_THROUGH = ['content-type', 'retry-after', 'x-discogs-ratelimit', 'x-discogs-ratelimit-used', 'x-discogs-ratelimit-remaining'];

export async function onRequestGet({ request, env, params }) {
  if (!configured(env)) return json({ error: 'Discogs is not configured on this server.' }, 503);

  const session = await readSession(request, env);
  if (!session) return json({ error: 'Not connected to Discogs.' }, 401);

  const segments = Array.isArray(params.path) ? params.path : [params.path];
  const upstreamPath = allowedUpstream(segments.join('/'), new URL(request.url).searchParams, session);
  if (!upstreamPath) return json({ error: 'That Discogs endpoint is not available.' }, 403);

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

  return new Response(upstream.body, { status: upstream.status, headers });
}

// Everything else on this path is off limits
export async function onRequest({ request }) {
  return json({ error: `${request.method} is not supported.` }, 405);
}

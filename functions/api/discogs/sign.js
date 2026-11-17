// GET /api/discogs/sign?path=<discogs path> - a one-request signature so the browser can read from Discogs directly.
// Discogs counts requests by the address they come from, and this server shares its address with other sites; the
// person's own connection has a budget of its own. Only reads the proxy would allow are signed (the person's own
// collection, releases, masters, artists and barcode searches), never anything else.
import { configured, apiBase, signedHeader } from '../../_lib/oauth.js';
import { readSession } from '../../_lib/session.js';
import { allowedUpstream } from '../../_lib/proxy.js';
import { json } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  if (!configured(env)) return json({ error: 'Discogs is not configured on this server.' }, 503);
  const session = await readSession(request, env);
  if (!session) return json({ error: 'Not connected to Discogs.' }, 401);

  const asked = new URL(request.url).searchParams.get('path') || '';
  let parsed;
  try {
    parsed = new URL(asked, 'https://placeholder.invalid');
  } catch {
    return json({ error: 'That Discogs endpoint is not available.' }, 403);
  }
  const upstreamPath = allowedUpstream(parsed.pathname, parsed.searchParams, session);
  if (!upstreamPath || upstreamPath.startsWith('/oauth/')) {
    return json({ error: 'That Discogs endpoint is not available.' }, 403);
  }

  const url = `${apiBase(env)}${upstreamPath}`;
  return json({ url, authorization: await signedHeader(env, session, url) });
}

export async function onRequest() {
  return json({ error: 'Not supported.' }, 405);
}

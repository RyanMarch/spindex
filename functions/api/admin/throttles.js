// GET /api/admin/throttles - recent Discogs slow-downs seen by the proxy, for the admin page. Needs the ADMIN_TOKEN
// secret in an Authorization header; without that secret set, the route does not exist.
import { json } from '../../_lib/http.js';
import { readEvents, summarize, sameSecret, egressInfo } from '../../_lib/telemetry.js';

export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_TOKEN) return json({ error: 'Not found.' }, 404);
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!sameSecret(token, env.ADMIN_TOKEN)) return json({ error: 'Not allowed.' }, 401);

  const events = await readEvents(env);
  return json({
    now: Date.now(),
    summary: summarize(events),
    events: events.slice(0, 100),
    egress: await egressInfo(),
    logging: Boolean(env.DISCOGS_DATA),
  });
}

export async function onRequest() {
  return json({ error: 'Not found.' }, 404);
}

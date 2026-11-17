// GET /api/admin/throttles - everything the admin page shows: setup, how requests are going by route, recent slow-downs
// and how loaded Discogs looks from this server. Needs the ADMIN_TOKEN secret in an Authorization header; without that
// secret set, the route does not exist.
import { json } from '../../_lib/http.js';
import { apiBase, USER_AGENT } from '../../_lib/oauth.js';
import { ttlSeconds } from '../../_lib/cache.js';
import { readEvents, readBuckets, summarize, summarizeRoutes, setupStatus, probeDiscogs, sameSecret, egressInfo } from '../../_lib/telemetry.js';

export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_TOKEN) return json({ error: 'Not found.' }, 404);
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!sameSecret(token, env.ADMIN_TOKEN)) return json({ error: 'Not allowed.' }, 401);

  const [events, buckets, egress, probe] = await Promise.all([
    readEvents(env),
    readBuckets(env),
    egressInfo(),
    probeDiscogs(apiBase(env), USER_AGENT),
  ]);
  return json({
    now: Date.now(),
    setup: setupStatus(env, ttlSeconds(env)),
    summary: summarize(events),
    routes: summarizeRoutes(buckets),
    events: events.slice(0, 100),
    egress,
    probe,
    logging: Boolean(env.DISCOGS_DATA),
  });
}

export async function onRequest() {
  return json({ error: 'Not found.' }, 404);
}

// GET /api/admin/throttles - everything the admin page shows: setup, how requests are going by route, recent slow-downs
// and how loaded Discogs looks from this server. Open to a signed-in Discogs account listed in ADMIN_USERS, or to the
// ADMIN_TOKEN secret as a Bearer token (see admin.js). With neither set up, the route does not exist.
import { json } from '../../_lib/http.js';
import { apiBase, USER_AGENT } from '../../_lib/oauth.js';
import { ttlSeconds } from '../../_lib/cache.js';
import { readEvents, readBuckets, summarize, summarizeRoutes, setupStatus, probeDiscogs, egressInfo } from '../../_lib/telemetry.js';
import { checkAdmin } from '../../_lib/admin.js';

export async function onRequestGet({ request, env }) {
  const access = await checkAdmin(request, env);
  if (!access.ok) return json({ error: access.error, reason: access.reason }, access.status);

  const [events, buckets, egress, probe] = await Promise.all([
    readEvents(env),
    readBuckets(env),
    egressInfo(),
    probeDiscogs(apiBase(env), USER_AGENT),
  ]);
  return json({
    now: Date.now(),
    via: access.via,
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

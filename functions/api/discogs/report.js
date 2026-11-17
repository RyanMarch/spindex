// POST /api/discogs/report - the app's own tally of how its Discogs requests went (see telemetry.js). Needs a signed-in
// session, accepts only a small, strictly checked body, and stores counts only.
import { configured } from '../../_lib/oauth.js';
import { readSession } from '../../_lib/session.js';
import { json } from '../../_lib/http.js';
import { validateReport, recordReport } from '../../_lib/telemetry.js';

const MAX_BYTES = 4096;

export async function onRequestPost({ request, env, waitUntil }) {
  if (!configured(env) || !(await readSession(request, env))) return json({ ok: false }, 401);
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ ok: false }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ ok: false }, 400);
  }
  const report = validateReport(body);
  if (!report) return json({ ok: false }, 400);
  const saved = recordReport(env, report);
  if (waitUntil) waitUntil(saved);
  else await saved;
  return json({ ok: true });
}

export async function onRequest() {
  return json({ error: 'Not supported.' }, 405);
}

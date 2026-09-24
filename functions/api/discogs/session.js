// GET /api/discogs/session - is this browser connected, and as whom? Never calls Discogs and never returns tokens.
import { configured } from '../../_lib/oauth.js';
import { readSession } from '../../_lib/session.js';
import { json } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  const session = configured(env) ? await readSession(request, env) : null;
  return json({ configured: configured(env), connected: Boolean(session), username: session?.u || null });
}

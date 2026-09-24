// GET /api/share/<id> - anyone with the link may read the snapshot. It is public by design: unlisted, not secret.
import { json } from '../../_lib/http.js';
import { SHARE_ID, shareKey } from '../../_lib/share.js';

export async function onRequestGet({ params, env }) {
  if (!env.SHARES) return json({ error: 'Sharing is not set up on this server.' }, 404);
  const id = String(params.id || '');
  if (!SHARE_ID.test(id)) return json({ error: 'No such crate.' }, 404);
  const snapshot = await env.SHARES.get(shareKey(id), 'json');
  if (!snapshot) return json({ error: 'This crate is not shared any more.' }, 404);
  return json(snapshot, 200, { 'Cache-Control': 'public, max-age=120' });
}

// POST /api/discogs/logout - forget the connection. (POST so another site can't trigger it with a link.)
import { clearCookie, SESSION_COOKIE } from '../../_lib/session.js';
import { json } from '../../_lib/http.js';

export async function onRequestPost({ request }) {
  return json({ connected: false }, 200, { 'Set-Cookie': clearCookie(request, SESSION_COOKIE) });
}

// GET /api/discogs/login[?return=/path] - start "Connect Discogs": get a request token, send the user to Discogs.
import { configured, requestToken, authorizeUrl } from '../../_lib/oauth.js';
import { seal, cookieHeader, LOGIN_COOKIE, safeReturnPath } from '../../_lib/session.js';
import { json, redirect } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  if (!configured(env)) return json({ error: 'Discogs is not configured on this server.' }, 503);

  const url = new URL(request.url);
  const callback = `${url.origin}/api/discogs/callback`;

  const rt = await requestToken(env, callback);
  if (!rt.ok) return redirect('/?discogs=error');

  // The request token's secret must survive the trip to Discogs and back; 15 minutes is how long Discogs honors it
  const loginCookie = await seal(env, { t: rt.token, s: rt.secret, r: safeReturnPath(url.searchParams.get('return')) }, 15 * 60);
  return redirect(
    `${authorizeUrl(env)}?oauth_token=${encodeURIComponent(rt.token)}`,
    [cookieHeader(request, LOGIN_COOKIE, loginCookie, { maxAge: 15 * 60, path: '/api/discogs' })]
  );
}

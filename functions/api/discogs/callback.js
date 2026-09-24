// GET /api/discogs/callback - Discogs sends the user back here with a verifier.
import { configured, accessToken, apiRequest } from '../../_lib/oauth.js';
import { open, seal, readCookie, cookieHeader, clearCookie, LOGIN_COOKIE, SESSION_COOKIE } from '../../_lib/session.js';
import { redirect } from '../../_lib/http.js';

const SESSION_DAYS = 180;

export async function onRequestGet({ request, env }) {
  if (!configured(env)) return redirect('/?discogs=error');

  const url = new URL(request.url);
  const token = url.searchParams.get('oauth_token');
  const verifier = url.searchParams.get('oauth_verifier');
  const clearLogin = clearCookie(request, LOGIN_COOKIE, '/api/discogs');

  const login = await open(env, readCookie(request, LOGIN_COOKIE));
  // The request token in the address must be the one we issued to this browser (also our CSRF check)
  if (!token || !verifier || !login || login.t !== token) return redirect('/?discogs=denied', [clearLogin]);

  const access = await accessToken(env, { token, secret: login.s, verifier });
  if (!access.ok) return redirect('/?discogs=error', [clearLogin]);

  // Who just signed in? Also proves the new token works.
  const who = await apiRequest(env, { t: access.token, s: access.secret }, '/oauth/identity');
  const identity = who.ok ? await who.json().catch(() => null) : null;
  if (!identity?.username) return redirect('/?discogs=error', [clearLogin]);

  const sessionCookie = await seal(env, { t: access.token, s: access.secret, u: identity.username }, SESSION_DAYS * 86400);
  const back = login.r && login.r !== '/' ? login.r : '/';
  const sep = back.includes('?') ? '&' : '?';
  return redirect(`${back}${sep}discogs=connected`, [
    cookieHeader(request, SESSION_COOKIE, sessionCookie, { maxAge: SESSION_DAYS * 86400 }),
    clearLogin,
  ]);
}

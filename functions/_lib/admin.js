// admin.js - who may open the admin page. Either of two ways in:
//  - signed in to Spindex with a Discogs account named in ADMIN_USERS (a comma-separated list, kept as a secret), or
//  - an ADMIN_TOKEN secret sent as a Bearer token, which stays for scripts and as a fallback.
// With neither set up, the admin routes do not exist.
import { configured } from './oauth.js';
import { readSession } from './session.js';
import { sameSecret } from './telemetry.js';

export const adminUsers = (env) => String(env?.ADMIN_USERS || '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);

// { ok: true, via } or { ok: false, status, error, reason } where reason is 'signin', 'not-admin' or 'token'
export async function checkAdmin(request, env) {
  const users = adminUsers(env);
  if (!env.ADMIN_TOKEN && users.length === 0) return { ok: false, status: 404, error: 'Not found.', reason: 'off' };

  const header = request.headers.get('authorization') || '';
  if (/^Bearer\s+/i.test(header)) {
    return env.ADMIN_TOKEN && sameSecret(header.replace(/^Bearer\s+/i, ''), env.ADMIN_TOKEN)
      ? { ok: true, via: 'token' }
      : { ok: false, status: 401, error: 'That token was not accepted.', reason: 'token' };
  }

  if (users.length && configured(env)) {
    const session = await readSession(request, env);
    if (!session) return { ok: false, status: 401, error: 'Sign in to continue.', reason: 'signin' };
    return users.includes(String(session.u || '').toLowerCase())
      ? { ok: true, via: 'session' }
      : { ok: false, status: 403, error: 'This Discogs account is not allowed here.', reason: 'not-admin' };
  }
  return { ok: false, status: 401, error: 'Enter the admin token.', reason: 'token' };
}

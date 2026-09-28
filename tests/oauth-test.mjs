// End-to-end test of the Discogs OAuth functions against a local mock of Discogs.
// Run with: node tests/oauth-test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { oauthHeader } from '../functions/_lib/oauth.js';
import { seal, open, safeReturnPath } from '../functions/_lib/session.js';
import { allowedUpstream } from '../functions/_lib/proxy.js';
import { onRequestGet as login } from '../functions/api/discogs/login.js';
import { onRequestGet as callback } from '../functions/api/discogs/callback.js';
import { onRequestGet as sessionInfo } from '../functions/api/discogs/session.js';
import { onRequestPost as logout } from '../functions/api/discogs/logout.js';
import { onRequestGet as proxy, onRequestPost as proxyPost } from '../functions/api/discogs/[[path]].js';

const CONSUMER_KEY = 'test-consumer-key';
const CONSUMER_SECRET = 'test-consumer-secret';
const ORIGIN = 'http://localhost:8780';

// ---- mock Discogs -------------------------------------------------------------------------------------------
// strict: which signature the access-token step accepts ('spec' = "cs&requestSecret", 'docs' = "cs&")
function startMock(strict) {
  const log = [];
  const parseAuth = (req) => Object.fromEntries([...String(req.headers.authorization || '').matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], decodeURIComponent(m[2])]));
  const server = http.createServer((req, res) => {
    const a = parseAuth(req);
    const url = new URL(req.url, 'http://mock');
    log.push(`${req.method} ${url.pathname}`);
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

    if (!req.headers['user-agent']?.includes('Spindex')) return send(400, { message: 'User-Agent required' });
    if (a.oauth_consumer_key !== CONSUMER_KEY) return send(401, { message: 'bad consumer' });

    if (url.pathname === '/oauth/request_token') {
      if (a.oauth_signature !== `${CONSUMER_SECRET}&` || !a.oauth_callback) return send(400, { message: 'bad request token request' });
      return send(200, 'oauth_token=REQ_TOKEN&oauth_token_secret=REQ_SECRET&oauth_callback_confirmed=true');
    }
    if (url.pathname === '/oauth/access_token') {
      const expected = strict === 'spec' ? `${CONSUMER_SECRET}&REQ_SECRET` : `${CONSUMER_SECRET}&`;
      if (a.oauth_token !== 'REQ_TOKEN' || a.oauth_verifier !== 'VERIFIER' || a.oauth_signature !== expected) return send(401, { message: 'bad access token request' });
      return send(200, 'oauth_token=ACCESS_TOKEN&oauth_token_secret=ACCESS_SECRET');
    }
    // everything else needs the access token, signed with both secrets
    if (a.oauth_token !== 'ACCESS_TOKEN' || a.oauth_signature !== `${CONSUMER_SECRET}&ACCESS_SECRET`) return send(401, { message: 'You must authenticate' });
    if (url.pathname === '/oauth/identity') return send(200, { id: 7, username: 'TestUser' });
    if (url.pathname === '/releases/123') return send(200, { id: 123, title: 'Mock Release' }, { 'X-Discogs-Ratelimit-Remaining': '55', 'X-Discogs-Ratelimit': '60' });
    if (url.pathname.toLowerCase() === '/users/testuser/collection/folders/0/releases') return send(200, { pagination: { pages: 1 }, releases: [], query: url.search });
    if (url.pathname === '/database/search') return send(200, { pagination: { items: 1 }, results: [{ id: 456, title: 'Barcode Album', barcode: ['075596086113'] }] });
    if (req.method === 'POST' && url.pathname.toLowerCase() === '/users/testuser/collection/folders/1/releases/456') return send(201, { instance_id: 888, resource_url: 'https://api.discogs.com/users/TestUser/collection/folders/1/releases/456/instances/888' });
    return send(404, { message: 'not found' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, log, base: `http://127.0.0.1:${server.address().port}` })));
}

const baseEnv = (mockBase) => ({
  DISCOGS_CONSUMER_KEY: CONSUMER_KEY,
  DISCOGS_CONSUMER_SECRET: CONSUMER_SECRET,
  SESSION_SECRET: 'a-long-random-test-session-secret-value',
  DISCOGS_API_BASE: mockBase,
});

const cookiesFrom = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
const cookieValue = (res, name) => (res.headers.getSetCookie?.() || []).find((c) => c.startsWith(`${name}=`));

async function fullFlow(strict) {
  const { server, log, base } = await startMock(strict);
  const env = baseEnv(base);
  try {
    // 1. login: redirects to Discogs' authorize page with the request token, and remembers its secret
    const start = await login({ request: new Request(`${ORIGIN}/api/discogs/login?return=/album/afi/black-sails/`), env });
    assert.equal(start.status, 302);
    assert.match(start.headers.get('Location'), /oauth\/authorize\?oauth_token=REQ_TOKEN$/);
    const loginSet = cookieValue(start, 'vc_oauth');
    assert.ok(loginSet.includes('HttpOnly') && loginSet.includes('SameSite=Lax') && loginSet.includes('Path=/api/discogs'));
    assert.ok(!loginSet.includes('Secure'), 'no Secure flag on http://localhost (Safari rejects it)');
    assert.ok(!loginSet.includes('REQ_SECRET'), 'the request token secret must be encrypted, not stored in plain text');

    // 2. callback: verifier comes back, tokens are exchanged, a session cookie is set, user lands where they started
    const back = await callback({
      request: new Request(`${ORIGIN}/api/discogs/callback?oauth_token=REQ_TOKEN&oauth_verifier=VERIFIER`, { headers: { Cookie: cookiesFrom(start) } }),
      env,
    });
    assert.equal(back.status, 302);
    assert.equal(back.headers.get('Location'), '/album/afi/black-sails/?discogs=connected');
    const sessionSet = cookieValue(back, 'vc_session');
    assert.ok(sessionSet && sessionSet.includes('HttpOnly'));
    assert.ok(!sessionSet.includes('ACCESS_TOKEN') && !sessionSet.includes('ACCESS_SECRET'), 'access token must be encrypted');
    assert.ok(cookieValue(back, 'vc_oauth')?.includes('Max-Age=0'), 'the temporary login cookie is cleared');
    const sessionCookie = sessionSet.split(';')[0];

    // 3. session status reflects the connection and never leaks tokens
    const status = await sessionInfo({ request: new Request(`${ORIGIN}/api/discogs/session`, { headers: { Cookie: sessionCookie } }), env });
    const info = await status.json();
    assert.deepEqual(info, { configured: true, connected: true, username: 'TestUser' });

    // 4. proxy: signed request goes through, rate-limit headers come back
    const rel = await proxy({ request: new Request(`${ORIGIN}/api/discogs/releases/123`, { headers: { Cookie: sessionCookie } }), env, params: { path: ['releases', '123'] } });
    assert.equal(rel.status, 200);
    assert.equal((await rel.json()).title, 'Mock Release');
    assert.equal(rel.headers.get('x-discogs-ratelimit-remaining'), '55');
    assert.equal(rel.headers.get('cache-control'), 'private, no-store');

    // own collection works (case-insensitive) and only page/per_page survive
    const col = await proxy({ request: new Request(`${ORIGIN}/api/discogs/users/TestUser/collection/folders/0/releases?page=2&per_page=100&evil=1`, { headers: { Cookie: sessionCookie } }), env, params: { path: ['users', 'TestUser', 'collection', 'folders', '0', 'releases'] } });
    assert.equal(col.status, 200);
    assert.equal((await col.json()).query, '?page=2&per_page=100');

    // barcode search works through the proxy
    const searchRes = await proxy({ request: new Request(`${ORIGIN}/api/discogs/database/search?barcode=075596086113&type=release`, { headers: { Cookie: sessionCookie } }), env, params: { path: ['database', 'search'] } });
    assert.equal(searchRes.status, 200);
    assert.equal((await searchRes.json()).results[0].title, 'Barcode Album');

    // adding a release to collection folder 1 works through proxy POST
    const addRes = await proxyPost({ request: new Request(`${ORIGIN}/api/discogs/users/TestUser/collection/folders/1/releases/456`, { method: 'POST', headers: { Cookie: sessionCookie } }), env, params: { path: ['users', 'TestUser', 'collection', 'folders', '1', 'releases', '456'] } });
    assert.equal(addRes.status, 201);
    assert.equal((await addRes.json()).instance_id, 888);

    // 5. the proxy refuses what it shouldn't
    const otherUser = await proxy({ request: new Request(`${ORIGIN}/x`, { headers: { Cookie: sessionCookie } }), env, params: { path: ['users', 'someoneelse', 'collection', 'folders', '0', 'releases'] } });
    assert.equal(otherUser.status, 403, "another user's collection is off limits");
    const otherUserPost = await proxyPost({ request: new Request(`${ORIGIN}/x`, { method: 'POST', headers: { Cookie: sessionCookie } }), env, params: { path: ['users', 'someoneelse', 'collection', 'folders', '1', 'releases', '456'] } });
    assert.equal(otherUserPost.status, 403);
    const marketplace = await proxy({ request: new Request(`${ORIGIN}/x`, { headers: { Cookie: sessionCookie } }), env, params: { path: ['marketplace', 'orders'] } });
    assert.equal(marketplace.status, 403);
    const anonymous = await proxy({ request: new Request(`${ORIGIN}/x`), env, params: { path: ['releases', '123'] } });
    assert.equal(anonymous.status, 401);

    // 6. a tampered cookie is not a session
    const tampered = sessionCookie.slice(0, -4) + 'AAAA';
    const bad = await sessionInfo({ request: new Request(`${ORIGIN}/api/discogs/session`, { headers: { Cookie: tampered } }), env });
    assert.equal((await bad.json()).connected, false);

    // 7. logout clears the cookie
    const out = await logout({ request: new Request(`${ORIGIN}/api/discogs/logout`, { method: 'POST' }) });
    assert.ok(cookieValue(out, 'vc_session').includes('Max-Age=0'));

    return log;
  } finally {
    server.close();
  }
}

// ---- tests --------------------------------------------------------------------------------------------------
// Whichever signature form Discogs really wants for the access-token step, we get through
let calls = await fullFlow('spec');
assert.equal(calls.filter((c) => c === 'POST /oauth/access_token').length, 1, 'spec-style signature works first time');
calls = await fullFlow('docs');
assert.equal(calls.filter((c) => c === 'POST /oauth/access_token').length, 2, "falls back to the documented '<secret>&' form");

// Security checks that need no mock
{
  const { server, base } = await startMock('spec');
  const env = baseEnv(base);
  try {
    const start = await login({ request: new Request(`${ORIGIN}/api/discogs/login`), env });
    const loginCookies = cookiesFrom(start);

    const mismatch = await callback({ request: new Request(`${ORIGIN}/api/discogs/callback?oauth_token=OTHER&oauth_verifier=VERIFIER`, { headers: { Cookie: loginCookies } }), env });
    assert.equal(mismatch.headers.get('Location'), '/?discogs=denied', 'a callback for a token we did not issue is rejected');

    const noCookie = await callback({ request: new Request(`${ORIGIN}/api/discogs/callback?oauth_token=REQ_TOKEN&oauth_verifier=VERIFIER`), env });
    assert.equal(noCookie.headers.get('Location'), '/?discogs=denied', 'a callback from a browser that never logged in is rejected');

    const unconfigured = await login({ request: new Request(`${ORIGIN}/api/discogs/login`), env: {} });
    assert.equal(unconfigured.status, 503);
    const shortSecret = await sessionInfo({ request: new Request(`${ORIGIN}/api/discogs/session`), env: { ...env, SESSION_SECRET: 'short' } });
    assert.equal((await shortSecret.json()).configured, false, 'a weak session secret counts as not configured');

    // upstream 401 (user revoked the app) clears the session
    const revokedSession = await seal(env, { t: 'REVOKED', s: 'REVOKED', u: 'TestUser' }, 3600);
    const revoked = await proxy({ request: new Request(`${ORIGIN}/x`, { headers: { Cookie: `vc_session=${revokedSession}` } }), env, params: { path: ['releases', '123'] } });
    assert.equal(revoked.status, 401);
    assert.ok(cookieValue(revoked, 'vc_session')?.includes('Max-Age=0'), 'a revoked token drops the session');
  } finally {
    server.close();
  }
}

// Cookies expire and can't be opened with another secret
{
  const env = baseEnv('http://unused');
  const expired = await seal(env, { u: 'x' }, -5);
  assert.equal(await open(env, expired), null);
  const sealed = await seal(env, { u: 'x' }, 60);
  assert.equal((await open(env, sealed)).u, 'x');
  assert.equal(await open({ ...env, SESSION_SECRET: 'a-completely-different-long-secret-string' }, sealed), null);
}

// Post-login redirects stay on this site
assert.equal(safeReturnPath('/album/a/b/'), '/album/a/b/');
for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', undefined, null, '']) assert.equal(safeReturnPath(bad), '/');

// Header format
{
  const h = oauthHeader({ DISCOGS_CONSUMER_KEY: 'k', DISCOGS_CONSUMER_SECRET: 's' }, { token: 't', tokenSecret: 'ts', verifier: 'v' });
  assert.match(h, /^OAuth /);
  assert.match(h, /oauth_signature_method="PLAINTEXT"/);
  assert.match(h, /oauth_signature="s&ts"/);
  assert.match(h, /oauth_token="t"/);
  assert.match(h, /oauth_verifier="v"/);
}

// Proxy allowlist
{
  const session = { u: 'Ryan' };
  const ok = (path, q = '') => allowedUpstream(path, new URLSearchParams(q), session);
  assert.equal(ok('releases/249504'), '/releases/249504');
  assert.equal(ok('masters/1'), '/masters/1');
  assert.equal(ok('artists/9'), '/artists/9');
  assert.equal(ok('oauth/identity'), '/oauth/identity');
  assert.equal(ok('users/ryan/collection/fields'), '/users/Ryan/collection/fields', "uses the signed-in user's own spelling");
  assert.equal(ok('users/ryan/collection/folders/0/releases', 'page=3&per_page=100&token=steal'), '/users/Ryan/collection/folders/0/releases?page=3&per_page=100');
  assert.equal(ok('database/search', 'barcode=075596086113&type=release'), '/database/search?barcode=075596086113&type=release');
  assert.equal(allowedUpstream('users/ryan/collection/folders/1/releases/456', new URLSearchParams(), session, 'POST'), '/users/Ryan/collection/folders/1/releases/456');
  assert.equal(allowedUpstream('users/someoneelse/collection/folders/1/releases/456', new URLSearchParams(), session, 'POST'), null);
  assert.equal(allowedUpstream('users/ryan/collection/folders/0/releases/456', new URLSearchParams(), session, 'POST'), null, 'cannot POST to folder 0');
  for (const path of ['users/other/collection/fields', 'marketplace/listings/1', 'releases/abc', 'releases/1/../../oauth/access_token', 'database/search', '', 'users/ryan/collection/folders/1/releases', 'users/ryan/wants']) {
    assert.equal(ok(path), null, `should refuse: ${path}`);
  }
  assert.equal(allowedUpstream('users/ryan/collection/fields', new URLSearchParams(), null), null, 'nothing but public data without a session');
}

console.log('Discogs OAuth tests passed.');

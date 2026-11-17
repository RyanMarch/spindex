// Tests for reading the private collection straight from the browser: the one-request signature, the endpoint that
// hands it out, and the client's fall-back to the proxy.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { hmacSha1Base64, signatureBase, signedHeader } from '../functions/_lib/oauth.js';
import { seal } from '../functions/_lib/session.js';
import { onRequestGet as sign } from '../functions/api/discogs/sign.js';

// ---- the signature ----------------------------------------------------------------------------------------------
// RFC 2202, test case 2: the HMAC-SHA1 itself is right
assert.equal(await hmacSha1Base64('Jefe', 'what do ya want for nothing?'), Buffer.from('effcdf6ae5eb2fa2d27416d5f184df9c259a7c79', 'hex').toString('base64'), 'matches the RFC test vector');

// The base string: method, address without its query, parameters sorted and encoded together
const base = signatureBase('get', 'https://api.discogs.com/users/ann/collection/folders/0/releases?per_page=100&page=2', { oauth_token: 'T', oauth_consumer_key: 'K' });
assert.equal(base, 'GET&https%3A%2F%2Fapi.discogs.com%2Fusers%2Fann%2Fcollection%2Ffolders%2F0%2Freleases&oauth_consumer_key%3DK%26oauth_token%3DT%26page%3D2%26per_page%3D100');

const env = { DISCOGS_CONSUMER_KEY: 'consumer-key', DISCOGS_CONSUMER_SECRET: 'consumer-secret-VALUE', SESSION_SECRET: 'a-long-random-test-session-secret-value' };
const session = { t: 'access-token', s: 'token-secret-VALUE', u: 'ann' };
const url = 'https://api.discogs.com/users/ann/collection/folders/0/releases?page=1&per_page=100';
const header = await signedHeader(env, session, url, { nonceValue: 'abc123', timestamp: 1700000000 });
const params = Object.fromEntries([...header.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], decodeURIComponent(m[2])]));
assert.equal(params.oauth_signature_method, 'HMAC-SHA1');
assert.equal(params.oauth_token, 'access-token');
const expected = createHmac('sha1', 'consumer-secret-VALUE&token-secret-VALUE').update(signatureBase('GET', url, { oauth_consumer_key: 'consumer-key', oauth_nonce: 'abc123', oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: '1700000000', oauth_token: 'access-token', oauth_version: '1.0' })).digest('base64');
assert.equal(params.oauth_signature, expected, 'signed with both secrets, checked independently');
assert.ok(!header.includes('consumer-secret-VALUE') && !header.includes('token-secret-VALUE'), 'no secret appears in the header');
assert.notEqual(await signedHeader(env, session, url), await signedHeader(env, session, url), 'every header has its own nonce');

// ---- the endpoint -----------------------------------------------------------------------------------------------
const cookie = `vc_session=${await seal(env, session, 3600)}`;
const ask = (path, headers = { Cookie: cookie }, e = env) => sign({ request: new Request(`https://spindex.test/api/discogs/sign?path=${encodeURIComponent(path)}`, { headers }), env: e });

const ok = await ask('/users/ann/collection/folders/0/releases?page=1&per_page=100');
assert.equal(ok.status, 200);
const body = await ok.json();
assert.equal(body.url, 'https://api.discogs.com/users/ann/collection/folders/0/releases?page=1&per_page=100');
assert.match(body.authorization, /^OAuth .*oauth_signature_method="HMAC-SHA1"/);
assert.ok(!JSON.stringify(body).includes('consumer-secret-VALUE'), 'the response holds no secret');
assert.equal((await ask('/users/ann/collection/fields')).status, 200, 'collection fields are signed too');
assert.equal((await ask('/users/ANN/collection/fields')).status, 200, 'the name is matched without regard to case');

assert.equal((await ask('/users/ann/collection/folders/0/releases', {})).status, 401, 'no session, no signature');
assert.equal((await ask('/users/bob/collection/folders/0/releases')).status, 403, "someone else's collection");
assert.equal((await ask('/releases/123')).status, 403, 'public pages stay on the cached proxy');
assert.equal((await ask('/database/search?barcode=0769152437408')).status, 403, 'searches stay on the proxy');
assert.equal((await ask('/oauth/identity')).status, 403);
assert.equal((await ask('/users/ann/collection/folders/0/releases?page=1&sort=drop')).status, 200, 'unknown query values are dropped, not signed');
assert.ok(!(await (await ask('/users/ann/collection/folders/0/releases?evil=1&page=1')).json()).url.includes('evil'), 'only vetted query values are signed');
assert.equal((await ask('/x', { Cookie: cookie }, {})).status, 503, 'not configured');

// ---- the client -------------------------------------------------------------------------------------------------
const calls = [];
let direct = () => new Response('{"releases":[]}', { status: 200 });
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.fetch = async (input, init = {}) => {
  const target = String(input);
  calls.push(target);
  if (target.endsWith('/api/discogs/session')) return new Response(JSON.stringify({ configured: true, connected: true, username: 'ann' }));
  if (target.startsWith('/api/discogs/sign')) return new Response(JSON.stringify({ url: 'https://api.discogs.com/users/ann/collection/folders/0/releases?page=1', authorization: 'OAuth test' }));
  if (target.startsWith('https://api.discogs.com/')) {
    assert.equal(init.headers.Authorization, 'OAuth test', 'the signature goes along');
    return direct();
  }
  return new Response('{"via":"proxy"}', { status: 200 });
};
const { initDiscogs, send, directAvailable, resetDirect } = await import('../public/js/discogs.js');
await initDiscogs();

const collection = '/users/ann/collection/folders/0/releases?page=1';
const first = await send(collection);
assert.equal(first.status, 200);
assert.deepEqual(calls.slice(-2).map((c) => c.split('?')[0]), ['/api/discogs/sign', 'https://api.discogs.com/users/ann/collection/folders/0/releases'], 'a collection read goes straight to Discogs');
assert.ok(!calls.some((c) => c.startsWith('/api/discogs/users')), 'and not through the proxy');

calls.length = 0;
await send('/releases/123');
assert.deepEqual(calls, ['/api/discogs/releases/123'], 'a public page stays on the proxy');
calls.length = 0;
await send(collection, { method: 'POST' });
assert.ok(calls[0].startsWith('/api/discogs/'), 'only reads go direct');

// A 429 from Discogs is passed on for the queue to handle, and direct stays on
direct = () => new Response('', { status: 429 });
assert.equal((await send(collection)).status, 429);
assert.equal(directAvailable(), true, 'a throttle is not a failure of the route');

// A refused signature falls back to the proxy for this and later requests
direct = () => new Response('', { status: 401 });
calls.length = 0;
const fellBack = await send(collection);
assert.equal((await fellBack.json()).via, 'proxy', 'the answer still arrives');
assert.equal(directAvailable(), false);
calls.length = 0;
await send(collection);
assert.deepEqual(calls, ['/api/discogs' + collection], 'later requests no longer try the direct route');

// A browser that blocks the request (CORS, a content blocker) falls back the same way
resetDirect();
direct = () => { throw new TypeError('Failed to fetch'); };
assert.equal((await (await send(collection)).json()).via, 'proxy');
assert.equal(directAvailable(), false);

console.log('Direct Discogs tests passed.');

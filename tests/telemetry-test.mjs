// Tests for the server-side slow-down log and the admin route that reads it.
import assert from 'node:assert/strict';
import { buildEvent, eventKey, recordEvent, readEvents, summarize, sameSecret, pathKind, egressInfo, LOG_PREFIX } from '../functions/_lib/telemetry.js';
import { onRequestGet as admin } from '../functions/api/admin/throttles.js';

const headers = (h) => ({ get: (k) => h[k] ?? null });

// Only a 429 is worth keeping, and nothing that names a person or a release
assert.equal(buildEvent({ status: 200, headers: headers({}), path: '/releases/1' }), null);
const event = buildEvent({ status: 429, headers: headers({ 'x-discogs-ratelimit-used': '12', 'x-discogs-ratelimit': '60' }), path: '/users/ann/collection/folders/0/releases?page=1', colo: 'EWR', now: 5000 });
assert.deepEqual(event, { at: 5000, kind: 'collection', used: 12, limit: 60, retryAfter: null, colo: 'EWR' });
assert.ok(!JSON.stringify(event).includes('ann'), 'the username never reaches the log');
assert.equal(buildEvent({ status: 429, headers: headers({}), path: '/x', now: 1 }).used, null, 'missing figures stay empty');
assert.equal(pathKind('/masters/5'), 'master');

// A small stand-in for a KV namespace: list returns keys in order, with their metadata
const kv = () => {
  const data = new Map();
  return {
    data,
    get: async (k) => data.get(k)?.v ?? null,
    put: async (k, v, opts) => data.set(k, { v, metadata: opts?.metadata, ttl: opts?.expirationTtl }),
    list: async ({ prefix }) => ({ keys: [...data.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: data.get(name).metadata })), list_complete: true }),
  };
};
const env = { DISCOGS_DATA: kv(), ADMIN_TOKEN: 'secret-token' };

assert.ok(eventKey(2000) < eventKey(1000), 'newer events sort first');
assert.ok(eventKey(1000).startsWith(LOG_PREFIX));

await recordEvent(env, { at: 1000, kind: 'release', used: 5, limit: 60, retryAfter: null, colo: 'EWR' });
await recordEvent(env, { at: 3000, kind: 'collection', used: 9, limit: 60, retryAfter: 20, colo: 'EWR' });
await recordEvent(env, { at: 2000, kind: 'release', used: 7, limit: 60, retryAfter: null, colo: 'LHR' });
await recordEvent({}, event); // no store bound: quietly nothing
const events = await readEvents(env);
assert.deepEqual(events.map((e) => e.at), [3000, 2000, 1000], 'newest first');
assert.equal([...env.DISCOGS_DATA.data.values()][0].ttl, 30 * 24 * 60 * 60, 'kept for thirty days');

const summary = summarize(events);
assert.equal(summary.total, 3);
assert.deepEqual(summary.byColo, { EWR: 2, LHR: 1 });
assert.equal(summary.medianUsed, 7);
assert.match(summary.reading, /shared address/);
assert.match(summarize([{ kind: 'release', used: 58, colo: 'EWR' }]).reading, /Spindex itself/);
assert.match(summarize([{ kind: 'release', used: null, colo: 'EWR' }]).reading, /unknown/);

assert.equal(sameSecret('abc', 'abc'), true);
assert.equal(sameSecret('abc', 'abd'), false);
assert.equal(sameSecret('abc', 'abcd'), false);
assert.equal(sameSecret('', ''), true);

assert.deepEqual(await egressInfo(async () => ({ text: async () => 'fl=1\nip=203.0.113.9\ncolo=EWR\nloc=US\n' })), { ip: '203.0.113.9', colo: 'EWR', loc: 'US' });
assert.equal(await egressInfo(async () => { throw new Error('offline'); }), null, 'a failed lookup is just empty');

// The admin route: absent without a token configured, closed without the right one
const ask = (e, auth) => admin({ request: new Request('https://x.test/api/admin/throttles', { headers: auth ? { Authorization: auth } : {} }), env: e });
assert.equal((await ask({ DISCOGS_DATA: env.DISCOGS_DATA }, 'Bearer secret-token')).status, 404, 'not set up: the route does not exist');
assert.equal((await ask(env)).status, 401, 'no token');
assert.equal((await ask(env, 'Bearer wrong')).status, 401, 'wrong token');
globalThis.fetch = async () => ({ text: async () => 'ip=203.0.113.9\ncolo=EWR\nloc=US\n' });
const ok = await ask(env, 'Bearer secret-token');
assert.equal(ok.status, 200);
const body = await ok.json();
assert.equal(body.events.length, 3);
assert.equal(body.summary.total, 3);
assert.equal(body.egress.ip, '203.0.113.9');
assert.equal(body.logging, true);

// Through the proxy: a 429 from Discogs is logged and still passed on; an ordinary answer is not logged
{
  const { seal } = await import('../functions/_lib/session.js');
  const { onRequestGet: proxy } = await import('../functions/api/discogs/[[path]].js');
  const logStore = kv();
  const proxyEnv = { DISCOGS_CONSUMER_KEY: 'k', DISCOGS_CONSUMER_SECRET: 's', SESSION_SECRET: 'a-long-random-test-session-secret-value', DISCOGS_DATA: logStore };
  const cookie = `vc_session=${await seal(proxyEnv, { t: 'T', s: 'S', u: 'TestUser' }, 3600)}`;
  const pending = [];
  const get = (path) => proxy({
    request: Object.assign(new Request(`https://spindex.test/api/discogs/${path.join('/')}`, { headers: { Cookie: cookie } }), { cf: { colo: 'EWR' } }),
    env: proxyEnv,
    params: { path },
    waitUntil: (p) => pending.push(p),
  });

  globalThis.fetch = async () => new Response('{"message":"slow down"}', { status: 429, headers: { 'x-discogs-ratelimit-used': '14', 'x-discogs-ratelimit': '60' } });
  const throttled = await get(['users', 'TestUser', 'collection', 'folders', '0', 'releases']);
  await Promise.all(pending);
  assert.equal(throttled.status, 429, 'the app still sees the 429');
  const kept = await readEvents(proxyEnv);
  assert.equal(kept.length, 1);
  assert.deepEqual({ kind: kept[0].kind, used: kept[0].used, colo: kept[0].colo }, { kind: 'collection', used: 14, colo: 'EWR' });
  assert.ok(!JSON.stringify(kept).includes('TestUser'), 'no name in the log');

  globalThis.fetch = async () => new Response('{"title":"Fine"}', { status: 200, headers: { 'content-type': 'application/json' } });
  await get(['releases', '7']);
  await Promise.all(pending);
  assert.equal((await readEvents(proxyEnv)).length, 1, 'an ordinary answer adds nothing');
}

console.log('Telemetry tests passed.');

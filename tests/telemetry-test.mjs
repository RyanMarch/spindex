// Tests for the server-side slow-down log and the admin route that reads it.
import assert from 'node:assert/strict';
import { buildEvent, eventKey, recordEvent, readEvents, summarize, sameSecret, pathKind, egressInfo, LOG_PREFIX, validateReport, mergeBucket, recordReport, readBuckets, summarizeRoutes, hourKey, setupStatus, probeDiscogs } from '../functions/_lib/telemetry.js';
import { createReporter, detectPlatform, outcomeOf } from '../public/js/reporter.js';
import { onRequestPost as report } from '../functions/api/discogs/report.js';
import { seal } from '../functions/_lib/session.js';
import { onRequestGet as admin } from '../functions/api/admin/throttles.js';

const headers = (h) => ({ get: (k) => h[k] ?? null });

// Only a 429 is worth keeping, and nothing that names a person or a release
assert.equal(buildEvent({ status: 200, headers: headers({}), path: '/releases/1' }), null);
const event = buildEvent({ status: 429, headers: headers({ 'x-discogs-ratelimit-used': '12', 'x-discogs-ratelimit': '60' }), path: '/users/ann/collection/folders/0/releases?page=1', colo: 'EWR', now: 5000 });
assert.deepEqual(event, { at: 5000, via: 'proxy', kind: 'collection', used: 12, limit: 60, retryAfter: null, colo: 'EWR' });
assert.ok(!JSON.stringify(event).includes('ann'), 'the username never reaches the log');
assert.equal(buildEvent({ status: 429, headers: headers({}), path: '/x', now: 1 }).used, null, 'missing figures stay empty');
assert.equal(pathKind('/masters/5'), 'master');

// A small stand-in for a KV namespace: list returns keys in order, with their metadata
const kv = () => {
  const data = new Map();
  return {
    data,
    get: async (k, type) => { const v = data.get(k)?.v ?? null; return type === 'json' && v !== null ? JSON.parse(v) : v; },
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
assert.match(summarize([{ kind: 'release', used: 58, colo: 'EWR' }]).reading, /Spindex may be using it/);
assert.match(summarize([{ kind: 'collection', used: 94, colo: 'CMH' }]).reading, /other traffic/, 'over the limit is not Spindex alone');
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
globalThis.fetch = async (url) => (String(url).includes('cdn-cgi/trace')
  ? { text: async () => 'ip=203.0.113.9\ncolo=EWR\nloc=US\n' }
  : { status: 200, headers: { get: (k) => ({ 'x-discogs-ratelimit-used': '40', 'x-discogs-ratelimit': '25', 'x-discogs-ratelimit-remaining': '0' })[k] ?? null } });
const ok = await ask(env, 'Bearer secret-token');
assert.equal(ok.status, 200);
const body = await ok.json();
assert.equal(body.events.length, 3);
assert.equal(body.summary.total, 3);
assert.equal(body.egress.ip, '203.0.113.9');
assert.equal(body.logging, true);
assert.equal(body.setup.dataStore, true);
assert.equal(body.setup.adminToken, true);
assert.ok(!JSON.stringify(body.setup).includes('secret-token'), 'the setup block never carries a secret');
assert.deepEqual(body.probe, { status: 200, used: 40, limit: 25, remaining: 0 }, 'how loaded Discogs looks from the server');
assert.ok(body.routes && Array.isArray(body.routes.series), 'route stats are included');

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

// ---- what the app reports -------------------------------------------------------------------------------------
{
  const good = validateReport({ counts: { 'direct|collection|ok': 3, 'proxy-hit|release|ok': 10, 'bogus|release|ok': 1, 'direct|nonsense|ok': 1, 'direct|release|ok': -4, 'direct|master|ok': 'x' }, throttles: [{ route: 'direct', kind: 'collection' }, { route: 'x', kind: 'y' }], direct: 'off:401', platform: 'ios', standalone: true });
  assert.deepEqual(good.counts, { 'direct|collection|ok': 3, 'proxy-hit|release|ok': 10 }, 'only known keys with sensible counts survive');
  assert.deepEqual(good.throttles, [{ route: 'direct', kind: 'collection' }]);
  assert.equal(good.direct, 'off:401');
  assert.equal(validateReport({ counts: {}, direct: '<script>', platform: 'toaster' }).direct, 'unknown', 'free text is refused');
  assert.equal(validateReport({ counts: {}, platform: 'toaster' }).platform, 'other');
  assert.equal(validateReport(null), null);
  assert.equal(validateReport({ nothing: 1 }), null);

  const bucket = mergeBucket(null, good, 1000);
  const twice = mergeBucket(bucket, good, 2000);
  assert.equal(twice.counts['direct|collection|ok'], 6, 'reports add up');
  assert.equal(twice.reports, 2);
  assert.deepEqual(twice.platforms, { 'ios-app': 2 });
  assert.equal(hourKey(Date.UTC(2026, 10, 17, 22, 30)), 'stat:2026-11-17T22');

  const bstore = { DISCOGS_DATA: kv() };
  const t0 = Date.UTC(2026, 10, 17, 21, 5);
  await recordReport(bstore, good, t0);
  await recordReport(bstore, validateReport({ counts: { 'direct|collection|throttled': 2, 'proxy-miss|release|ok': 4 }, throttles: [{ route: 'direct', kind: 'collection' }, { route: 'proxy-miss', kind: 'artist' }], direct: 'on', platform: 'desktop' }), t0 + 3600000);
  const buckets = await readBuckets(bstore);
  assert.deepEqual(buckets.map((b) => b.hour), ['2026-11-17T21', '2026-11-17T22']);
  const routes = summarizeRoutes(buckets);
  assert.equal(routes.totals['direct|ok'], 3);
  assert.equal(routes.totals['direct|throttled'], 2);
  assert.equal(routes.series[1].throttled, 2);
  assert.equal(routes.series[0].requests, 13);
  assert.equal(routes.lastDirectOkHour, '2026-11-17T21', 'the last hour a direct request worked');
  assert.equal(routes.byKind['collection|direct'], 5);
  assert.deepEqual(routes.devices, { 'ios-app': 1, 'desktop-browser': 1 });
  const throttled = await readEvents(bstore);
  assert.equal(throttled.length, 2, 'direct throttles are logged; a proxy one the server already saw is not logged twice');
  assert.ok(throttled.every((e) => e.via === 'direct'));
  assert.equal(throttled[0].via, 'direct');
  assert.deepEqual(summarizeRoutes([]).series, []);

  const setup = setupStatus({ DISCOGS_CONSUMER_KEY: 'k', DISCOGS_CONSUMER_SECRET: 's', SESSION_SECRET: 'short', ADMIN_TOKEN: 'x' }, 86400);
  assert.deepEqual(setup, { discogsKey: true, discogsSecret: true, sessionSecret: false, adminToken: true, sharesStore: false, dataStore: false, cacheSeconds: 86400, apiBase: 'discogs.com' });
  assert.equal(await probeDiscogs('https://x', 'ua', async () => { throw new Error('down'); }), null);

  // The endpoint: needs a session, small strict bodies only
  const renv = { DISCOGS_CONSUMER_KEY: 'k', DISCOGS_CONSUMER_SECRET: 's', SESSION_SECRET: 'a-long-random-test-session-secret-value', DISCOGS_DATA: kv() };
  const rcookie = `vc_session=${await seal(renv, { t: 'T', s: 'S', u: 'ann' }, 3600)}`;
  const post = (body, headers = { Cookie: rcookie }) => report({ request: new Request('https://x.test/api/discogs/report', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers }), env: renv });
  assert.equal((await post({ counts: { 'direct|release|ok': 1 } }, {})).status, 401, 'no session, no report');
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post({ nope: 1 })).status, 400);
  assert.equal((await post('x'.repeat(5000))).status, 413);
  assert.equal((await post({ counts: { 'direct|release|ok': 2 }, direct: 'on', platform: 'ios' })).status, 200);
  assert.equal((await readBuckets(renv))[0].counts['direct|release|ok'], 2);
  assert.ok(!JSON.stringify(await readBuckets(renv)).includes('ann'), 'no name is stored');
}

// ---- the app's tally -------------------------------------------------------------------------------------------
{
  assert.equal(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'ios');
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'ios', 'an iPad that says it is a Mac');
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'desktop');
  assert.equal(detectPlatform('Mozilla/5.0 (Linux; Android 14)'), 'android');
  assert.equal(outcomeOf(200), 'ok');
  assert.equal(outcomeOf(404), 'ok', 'a missing release is an answer, not a failure');
  assert.equal(outcomeOf(429), 'throttled');
  assert.equal(outcomeOf(503), 'failed');

  const sent = [];
  const reporter = createReporter({ send: (b) => sent.push(b), directState: () => 'on', platform: 'ios', standalone: true, flushAt: 3 });
  reporter.note('direct', 'collection', 'ok');
  reporter.note('direct', 'collection', 'ok');
  assert.equal(sent.length, 0, 'small batches wait');
  reporter.note('proxy-hit', 'release', 'ok');
  assert.equal(sent.length, 1, 'a full batch goes out');
  assert.deepEqual(sent[0].counts, { 'direct|collection|ok': 2, 'proxy-hit|release|ok': 1 });
  assert.equal(sent[0].direct, 'on');
  reporter.note('direct', 'collection', 'throttled');
  assert.equal(sent.length, 2, 'a throttle goes out at once');
  assert.deepEqual(sent[1].throttles, [{ route: 'direct', kind: 'collection' }]);
  reporter.flush();
  assert.equal(sent.length, 2, 'nothing pending, nothing sent');
  createReporter({ send: () => { throw new Error('offline'); } }).note('direct', 'release', 'throttled'); // never throws into the app
}

console.log('Telemetry tests passed.');

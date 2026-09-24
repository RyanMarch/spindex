// Tests for the edge cache in front of the Discogs proxy: what it caches, what it never caches, and that only
// signed-in people can read from it.
import assert from 'node:assert/strict';
import { cacheablePath, cacheKey, ttlSeconds, stripMarketplace } from '../functions/_lib/cache.js';
import { seal } from '../functions/_lib/session.js';
import { onRequestGet as proxy } from '../functions/api/discogs/[[path]].js';

assert.equal(cacheablePath('/releases/123'), '/releases/123');
assert.equal(cacheablePath('/masters/9?page=2'), '/masters/9');
assert.equal(cacheablePath('/artists/55'), '/artists/55');
assert.equal(cacheablePath('/users/bob/collection/folders/0/releases?page=1'), null, 'a collection is private');
assert.equal(cacheablePath('/oauth/identity'), null);
assert.equal(cacheablePath('/releases/abc'), null);
assert.equal(cacheKey('/releases/1').url, 'https://cache.spindex.internal/discogs/releases/1');

assert.equal(ttlSeconds({}), 604800, 'a week by default');
assert.equal(ttlSeconds({ DISCOGS_CACHE_SECONDS: '600' }), 600);
assert.equal(ttlSeconds({ DISCOGS_CACHE_SECONDS: '0' }), 0, '0 turns it off');
assert.equal(ttlSeconds({ DISCOGS_CACHE_SECONDS: '99999999' }), 2592000, 'capped at thirty days');
assert.equal(ttlSeconds({ DISCOGS_CACHE_SECONDS: 'nonsense' }), 604800);

assert.deepEqual(JSON.parse(stripMarketplace('{"title":"A","lowest_price":9.5,"num_for_sale":4}')), { title: 'A' }, 'prices are removed');
assert.equal(stripMarketplace('not json'), 'not json');

// ---- through the proxy, with an in-memory stand-in for Cloudflare's cache ----------------------------------------
const store = new Map();
globalThis.caches = {
  default: {
    async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { store.set(req.url, res); },
  },
};

let upstreamCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  upstreamCalls++;
  return new Response(JSON.stringify({ title: 'Cached Release', url: String(url), lowest_price: 12, num_for_sale: 3 }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-discogs-ratelimit-remaining': '50' },
  });
};

try {
  const env = { DISCOGS_CONSUMER_KEY: 'k', DISCOGS_CONSUMER_SECRET: 's', SESSION_SECRET: 'a-long-random-test-session-secret-value' };
  const cookie = `vc_session=${await seal(env, { t: 'T', s: 'S', u: 'TestUser' }, 3600)}`;
  const get = (path, headers = { Cookie: cookie }) => proxy({
    request: new Request(`https://spindex.test/api/discogs/${path.join('/')}`, { headers }),
    env,
    params: { path },
    waitUntil: () => {},
  });

  const first = await get(['releases', '1']);
  assert.equal(first.headers.get('x-spindex-cache'), 'MISS');
  const firstBody = await first.json();
  assert.equal(firstBody.title, 'Cached Release');
  assert.ok(!('lowest_price' in firstBody) && !('num_for_sale' in firstBody), 'marketplace fields never reach the app');
  await new Promise((resolve) => setTimeout(resolve)); // let the background put finish

  const second = await get(['releases', '1']);
  assert.equal(second.headers.get('x-spindex-cache'), 'HIT');
  assert.equal(second.headers.get('cache-control'), 'private, no-store', 'the browser is never told to cache it');
  const secondBody = await second.json();
  assert.equal(secondBody.title, 'Cached Release');
  assert.ok(!('lowest_price' in secondBody), 'and never sit in the cache');
  assert.equal(upstreamCalls, 1, 'the second request never reached Discogs');

  await get(['releases', '2']);
  assert.equal(upstreamCalls, 2, 'a different release is a different cache entry');

  // The collection is never cached
  await get(['users', 'TestUser', 'collection', 'folders', '0', 'releases']);
  await new Promise((resolve) => setTimeout(resolve));
  await get(['users', 'TestUser', 'collection', 'folders', '0', 'releases']);
  assert.equal(upstreamCalls, 4, 'private collection pages always go to Discogs');
  assert.ok(![...store.keys()].some((key) => key.includes('collection')), 'nothing about the collection was stored');

  // Cached pages are not readable without a session
  const anonymous = await get(['releases', '1'], {});
  assert.equal(anonymous.status, 401);

  // Errors are not cached
  globalThis.fetch = async () => { upstreamCalls++; return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }); };
  await get(['releases', '404']);
  await new Promise((resolve) => setTimeout(resolve));
  assert.ok(!store.has('https://cache.spindex.internal/discogs/releases/404'), 'a 404 is not stored');

  // DISCOGS_CACHE_SECONDS=0 switches it off
  store.clear();
  globalThis.fetch = async () => { upstreamCalls++; return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  const off = await proxy({
    request: new Request('https://spindex.test/api/discogs/releases/7', { headers: { Cookie: cookie } }),
    env: { ...env, DISCOGS_CACHE_SECONDS: '0' },
    params: { path: ['releases', '7'] },
    waitUntil: () => {},
  });
  assert.equal(off.headers.get('x-spindex-cache'), null);
  assert.equal(store.size, 0);

  console.log('Edge cache tests passed.');
} finally {
  globalThis.fetch = realFetch;
  delete globalThis.caches;
}

// Runs the real service worker in a sandbox, with fake caches and network, to check what it stores and serves.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function boot({ network }) {
  const stores = new Map();
  const listeners = {};
  const makeCache = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    return {
      match: async (req) => { const hit = map.get(typeof req === 'string' ? req : req.url); return hit ? hit.clone?.() ?? hit : undefined; },
      put: async (req, res) => { map.set(typeof req === 'string' ? req : req.url, res); },
      delete: async (req) => map.delete(typeof req === 'string' ? req : req.url),
      keys: async () => [...map.keys()].map((url) => ({ url })),
      addAll: async () => {},
    };
  };
  const sandbox = {
    self: { addEventListener: (type, fn) => { listeners[type] = fn; }, skipWaiting() {}, clients: { claim() {} } },
    caches: {
      open: async (name) => makeCache(name),
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
      match: async () => undefined,
    },
    fetch: network,
    Response,
    URL,
    Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(source.replace('const CACHE_NAME', 'var CACHE_NAME').replace('const IMAGE_CACHE', 'var IMAGE_CACHE').replace('const MAX_IMAGES = 600', 'var MAX_IMAGES = 3'), sandbox);
  return { stores, fire: (type, event) => listeners[type](event), sandbox };
}

const image = (url) => ({ url, method: 'GET', destination: 'image', mode: 'no-cors' });
const fetchEvent = (request) => { const e = { request, responded: null, respondWith(p) { e.responded = p; } }; return e; };
const ok = (body = 'img') => ({ status: 200, type: 'basic', clone() { return this; }, body });
const opaque = () => ({ status: 0, type: 'opaque', clone() { return this; } });

// A first request goes to the network and is kept; the next is answered from the cache
{
  let calls = 0;
  const { stores, fire } = boot({ network: async () => { calls++; return ok('cover'); } });
  const first = fetchEvent(image('https://cdn.example/cover.jpg'));
  fire('fetch', first);
  await first.responded;
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(stores.get('spindex-images-v1').size, 1, 'a picture is kept in the image cache');

  const second = fetchEvent(image('https://cdn.example/cover.jpg'));
  fire('fetch', second);
  assert.equal((await second.responded).body, 'cover', 'and served from it');
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(calls, 2, 'while a fresh copy is fetched in the background');
}

// Pictures from other sites arrive as opaque responses and are kept too; errors are not
{
  let mode = 'opaque';
  const { stores, fire } = boot({ network: async () => (mode === 'opaque' ? opaque() : { status: 500, type: 'basic', clone() { return this; } }) });
  const a = fetchEvent(image('https://cdn.other/a.jpg'));
  fire('fetch', a);
  await a.responded;
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(stores.get('spindex-images-v1').size, 1, 'an opaque cover is kept');
  mode = 'error';
  const b = fetchEvent(image('https://cdn.other/b.jpg'));
  fire('fetch', b);
  await b.responded;
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(stores.get('spindex-images-v1').size, 1, 'a failed response is not kept');
}

// Offline: a cached picture still shows; an uncached one fails cleanly
{
  let online = true;
  const { fire } = boot({ network: async () => { if (!online) throw new Error('offline'); return ok('cover'); } });
  const warm = fetchEvent(image('https://cdn.example/x.jpg'));
  fire('fetch', warm);
  await warm.responded;
  await new Promise((resolve) => setTimeout(resolve));
  online = false;
  const cached = fetchEvent(image('https://cdn.example/x.jpg'));
  fire('fetch', cached);
  assert.equal((await cached.responded).body, 'cover', 'offline, a cached cover still shows');
  const missing = fetchEvent(image('https://cdn.example/never-seen.jpg'));
  fire('fetch', missing);
  assert.equal((await missing.responded).type, 'error', 'an uncached one fails cleanly instead of hanging');
}

// The cache is bounded: the oldest pictures go first
{
  const { stores, fire } = boot({ network: async () => ok('cover') });
  for (let i = 1; i <= 6; i++) {
    const e = fetchEvent(image(`https://cdn.example/${i}.jpg`));
    fire('fetch', e);
    await e.responded;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  const kept = [...stores.get('spindex-images-v1').keys()];
  assert.ok(kept.length <= 3, `at most 3 kept in this test (${kept.length})`);
  assert.ok(kept.includes('https://cdn.example/6.jpg') && !kept.includes('https://cdn.example/1.jpg'), 'the newest stay, the oldest go');
}

// Per-user server functions are never cached, and app updates keep the pictures
{
  const calls = [];
  const { stores, fire } = boot({ network: async (r) => { calls.push(r.url); return ok(); } });
  const api = fetchEvent({ url: 'https://spindex.test/api/discogs/releases/1', method: 'GET', destination: '', mode: 'cors' });
  fire('fetch', api);
  assert.equal(api.responded, null, 'the service worker steps aside for /api/');
  const post = fetchEvent({ url: 'https://spindex.test/x', method: 'POST', destination: 'image' });
  fire('fetch', post);
  assert.equal(post.responded, null, 'only GETs');

  stores.set('spindex-images-v1', new Map([['keep', 1]]));
  stores.set('spindex-cache-v1', new Map());
  const activate = { waitUntil(p) { activate.done = p; } };
  fire('activate', activate);
  await activate.done;
  assert.ok(stores.has('spindex-images-v1'), 'updating the app does not throw away the cached pictures');
  assert.ok(!stores.has('spindex-cache-v1'), 'but old app files are removed');
}
console.log('Service worker tests passed.');

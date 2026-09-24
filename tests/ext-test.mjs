// Tests for the caching proxy in front of Wikipedia, MusicBrainz and friends: what it will fetch, who may ask,
// what it caches, and what it never remembers.
import assert from 'node:assert/strict';
import { allowedSource, sameSite, onRequestGet } from '../functions/api/ext.js';

// ---- what it will fetch ------------------------------------------------------------------------------------------
assert.ok(allowedSource('https://en.wikipedia.org/w/api.php?action=parse&page=X'));
assert.ok(allowedSource('https://en.wikipedia.org/w/rest.php/v1/search/title?q=AFI'));
assert.ok(allowedSource('https://en.wikipedia.org/api/rest_v1/page/summary/Bodies'));
assert.ok(allowedSource('https://musicbrainz.org/ws/2/release-group?query=x&fmt=json'));
assert.ok(allowedSource('https://musicbrainz.org/ws/2/release?release-group=abc&fmt=json'));
assert.ok(allowedSource('https://coverartarchive.org/release/ff82a527-5b17-4acc-9c17-aa3b17f9e838'));
assert.equal(allowedSource('http://en.wikipedia.org/w/api.php'), null, 'https only');
assert.equal(allowedSource('https://evil.example/w/api.php'), null, 'other hosts');
assert.equal(allowedSource('https://en.wikipedia.org.evil.example/w/api.php'), null, 'lookalike hosts');
assert.equal(allowedSource('https://en.wikipedia.org/wiki/Special:Random'), null, 'other paths');
assert.equal(allowedSource('https://user:pw@en.wikipedia.org/w/api.php'), null, 'no credentials');
assert.equal(allowedSource('https://musicbrainz.org/ws/2/artist/abc'), null, 'only the lookups the app needs');
assert.equal(allowedSource('not a url'), null);
assert.equal(allowedSource(null), null);

// ---- who may ask -------------------------------------------------------------------------------------------------
const req = (headers, url = 'https://spindex.test/api/ext?url=x') => new Request(url, { headers });
assert.equal(sameSite(req({ 'Sec-Fetch-Site': 'same-origin' })), true);
assert.equal(sameSite(req({ 'Sec-Fetch-Site': 'cross-site' })), false);
assert.equal(sameSite(req({ Origin: 'https://spindex.test' })), true);
assert.equal(sameSite(req({ Referer: 'https://elsewhere.test/page' })), false);
assert.equal(sameSite(req({})), false, 'no evidence of origin, no service');

// ---- caching -----------------------------------------------------------------------------------------------------
const store = new Map();
globalThis.caches = {
  default: {
    async match(r) { const hit = store.get(r.url); return hit ? hit.clone() : undefined; },
    async put(r, res) { store.set(r.url, res); },
  },
};
let calls = 0;
let mode = 'ok';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  calls++;
  assert.match(init.headers['User-Agent'], /^Spindex\//, 'identifies itself to the source');
  if (mode === 'notfound') return new Response('{"error":"nope"}', { status: 404, headers: { 'content-type': 'application/json' } });
  if (mode === 'busy') return new Response('busy', { status: 503, headers: { 'retry-after': '2' } });
  if (mode === 'down') throw new Error('offline');
  return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
};

try {
  const ask = (target, headers = { 'Sec-Fetch-Site': 'same-origin' }) => onRequestGet({
    request: new Request(`https://spindex.test/api/ext?url=${encodeURIComponent(target)}`, { headers }),
    waitUntil: () => {},
  });
  const later = () => new Promise((resolve) => setTimeout(resolve));
  const page = 'https://en.wikipedia.org/w/api.php?action=parse&page=Bodies';

  const first = await ask(page);
  assert.equal(first.headers.get('x-spindex-cache'), 'MISS');
  assert.equal(first.headers.get('x-spindex-proxy'), '1');
  assert.deepEqual(await first.json(), { ok: true });
  await later();
  const second = await ask(page);
  assert.equal(second.headers.get('x-spindex-cache'), 'HIT');
  assert.equal(calls, 1, 'the second request never reached Wikipedia');

  assert.equal((await ask('https://evil.example/x')).status, 403);
  assert.equal((await ask(page, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal(calls, 1, 'refused requests reach nobody');

  // "not found" is remembered (briefly); busy and down are not
  mode = 'notfound';
  const missing = await ask('https://en.wikipedia.org/w/api.php?action=parse&page=Nope');
  assert.equal(missing.status, 404);
  await later();
  assert.equal((await ask('https://en.wikipedia.org/w/api.php?action=parse&page=Nope')).headers.get('x-spindex-cache'), 'HIT');

  mode = 'busy';
  const busy = await ask('https://musicbrainz.org/ws/2/release-group?query=a&fmt=json');
  assert.equal(busy.status, 503, 'the caller is told to back off');
  assert.equal(busy.headers.get('retry-after'), '2');
  await later();
  assert.equal(store.size, 2, 'a throttled answer is not stored');

  mode = 'down';
  assert.equal((await ask('https://musicbrainz.org/ws/2/release?release-group=x&fmt=json')).status, 502);

  console.log('External source proxy tests passed.');
} finally {
  globalThis.fetch = realFetch;
  delete globalThis.caches;
}

// ---- Deezer answers are cached the same way ----------------------------------------------------------------------
import { onRequestGet as deezer } from '../functions/api/listen/deezer.js';
{
  const store = new Map();
  globalThis.caches = { default: { async match(r) { const h = store.get(r.url); return h ? h.clone() : undefined; }, async put(r, res) { store.set(r.url, res); } } };
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ data: [{ title: 'Bodies', artist: { name: 'AFI' }, link: 'https://deezer/1', cover_xl: 'https://img/1000x1000-x.jpg' }] }), { status: 200 });
  };
  try {
    const ask = () => deezer({ request: new Request('https://spindex.test/api/listen/deezer?artist=AFI&title=Bodies'), waitUntil: () => {} });
    const first = await ask();
    assert.equal(first.headers.get('x-spindex-cache'), 'MISS');
    assert.deepEqual(await first.json(), { url: 'https://deezer/1', cover: 'https://img/1000x1000-x.jpg' });
    await new Promise((resolve) => setTimeout(resolve));
    const second = await ask();
    assert.equal(second.headers.get('x-spindex-cache'), 'HIT');
    assert.equal((await second.json()).url, 'https://deezer/1');
    assert.equal(calls, 1, 'the second lookup never reached Deezer');
    console.log('Deezer cache tests passed.');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.caches;
  }
}

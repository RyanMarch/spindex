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
    // A title the fielded search misses is found by the plain-text fallback, and only an exact artist and title is accepted
    store.clear();
    const seenQueries = [];
    globalThis.fetch = async (url) => {
      const q = decodeURIComponent(new URL(url).searchParams.get('q'));
      seenQueries.push(q);
      const albums = q.startsWith('artist:') ? [] : [
        { title: 'TRON: Legacy - The Complete Edition (Original Motion Picture Soundtrack)', artist: { name: 'Daft Punk' }, link: 'https://deezer/complete', cover_xl: 'https://img/complete' },
        { title: 'TRON: Legacy', artist: { name: 'Daft Punk' }, link: 'https://deezer/tron', cover_xl: 'https://img/1000x1000-tron.jpg' },
        { title: 'TRON: Legacy', artist: { name: 'Somebody Else' }, link: 'https://deezer/wrong', cover_xl: 'https://img/wrong' },
      ];
      return new Response(JSON.stringify({ data: albums }), { status: 200 });
    };
    const tron = await deezer({ request: new Request('https://spindex.test/api/listen/deezer?artist=Daft%20Punk&title=' + encodeURIComponent('TRON: Legacy (Vinyl Edition Motion Picture Soundtrack)')), waitUntil: () => {} });
    assert.deepEqual(await tron.json(), { url: 'https://deezer/tron', cover: 'https://img/1000x1000-tron.jpg' });
    assert.equal(seenQueries.length, 2, 'the fielded search came up empty, then the plain-text one ran');
    assert.equal(seenQueries[1], 'Daft Punk TRON: Legacy', 'without the bracketed qualifier');

    // a failure on the second search is a failure, not a "no match" that would be remembered
    store.clear();
    let n = 0;
    globalThis.fetch = async () => (++n === 1 ? new Response('{"data":[]}', { status: 200 }) : new Response('oops', { status: 500 }));
    const failed = await deezer({ request: new Request('https://spindex.test/api/listen/deezer?artist=A&title=B'), waitUntil: () => {} });
    assert.equal(failed.status, 502);
    assert.equal(store.size, 0, 'nothing is cached from a failure');
    console.log('Deezer cache tests passed.');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.caches;
  }
}

// ---- the image relay ---------------------------------------------------------------------------------------------
import { allowedImage, onRequestGet as image } from '../functions/api/img.js';
{
  assert.ok(allowedImage('https://i.discogs.com/abc/rs:fit/h:150/w:150/xyz'));
  assert.equal(allowedImage('http://i.discogs.com/abc'), null, 'https only');
  assert.equal(allowedImage('https://evil.example/abc'), null, 'one host only');
  assert.equal(allowedImage('https://i.discogs.com.evil.example/abc'), null);
  assert.equal(allowedImage('https://user:pw@i.discogs.com/abc'), null);
  assert.equal(allowedImage('junk'), null);

  const realFetch = globalThis.fetch;
  let mode = 'image';
  globalThis.fetch = async () => {
    if (mode === 'html') return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    if (mode === 'missing') return new Response('nope', { status: 404 });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const ask = (target, headers = { 'Sec-Fetch-Site': 'same-origin' }) => image({ request: new Request(`https://spindex.test/api/img?url=${encodeURIComponent(target)}`, { headers }) });
    const ok = await ask('https://i.discogs.com/abc/xyz');
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/jpeg');
    assert.equal(ok.headers.get('x-spindex-proxy'), '1');
    assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [1, 2, 3]);
    assert.equal((await ask('https://evil.example/x')).status, 403);
    assert.equal((await ask('https://i.discogs.com/abc', { 'Sec-Fetch-Site': 'cross-site' })).status, 403, 'only pages on this site');
    mode = 'html';
    assert.equal((await ask('https://i.discogs.com/abc')).status, 502, 'anything that is not an image is refused');
    mode = 'missing';
    assert.equal((await ask('https://i.discogs.com/abc')).status, 404);
    console.log('Image relay tests passed.');
  } finally {
    globalThis.fetch = realFetch;
  }
}

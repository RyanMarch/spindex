// Tests for the read-only link: who may publish, what is stored (and what never is), who may read it.
import assert from 'node:assert/strict';
import { seal, SESSION_COOKIE } from '../functions/_lib/session.js';
import { cleanRecord, cleanRecords, newShareId, SHARE_ID, MAX_RECORDS } from '../functions/_lib/share.js';
import { onRequestGet as status, onRequestPost as publish, onRequestDelete as remove } from '../functions/api/share/index.js';
import { shareIdFromPath, buildSnapshot, shareIsStale } from '../public/js/share.js';
import { onRequestGet as read } from '../functions/api/share/[id].js';

// a KV namespace in miniature
const kv = () => {
  const map = new Map();
  return {
    map,
    async get(key, type) { const v = map.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(key, value) { map.set(key, value); },
    async delete(key) { map.delete(key); },
  };
};
const ORIGIN = 'https://spindex.test';
const env = { SESSION_SECRET: 'test-secret', SHARES: kv() };
const cookie = `${SESSION_COOKIE}=${await seal(env, { u: 'Ryan', t: 'x', s: 'y' }, 3600)}`;
const request = (method, { body, headers = {}, signedIn = true, path = '/api/share' } = {}) => new Request(`${ORIGIN}${path}`, {
  method,
  headers: { 'Sec-Fetch-Site': 'same-origin', ...(signedIn ? { Cookie: cookie } : {}), ...headers },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});

const rec = (n, extra = {}) => ({
  id: `discogs_${n}`, title: `Album ${n}`, artist: 'AFI', year: 1999, genres: ['Rock'], styles: ['Punk'],
  artwork: { highRes: 'https://i.discogs.com/a.jpg', thumbnail: 'https://i.discogs.com/b.jpg', source: 'discogs' },
  tracklist: [{ position: 'A1', title: 'Song', duration: '3:00' }],
  details: { status: 'Accepted', formats: [{ name: 'Vinyl', qty: '2', descriptions: ['LP'], text: 'Red' }], notes: 'PRIVATE', credits: [{ name: 'x' }] },
  context: { wikiTitle: 'X', sections: [] }, // gathered from elsewhere: not shared
  conditionMedia: 'Mint', personalNotes: 'PRIVATE NOTE', collectionFields: { Notes: 'PRIVATE' },
  ...extra,
});

// ---- what is stored ----------------------------------------------------------------------------------------------
{
  const clean = cleanRecord(rec(1));
  assert.deepEqual(Object.keys(clean).sort(), ['artist', 'artwork', 'details', 'genres', 'id', 'styles', 'title', 'tracklist', 'year'].sort());
  assert.ok(!JSON.stringify(clean).includes('PRIVATE'), 'notes and personal fields never leave');
  assert.equal(clean.details.formats[0].qty, '2');
  assert.equal(cleanRecord(rec('mock_1', { id: 'discogs_mock_001' })), null, 'the demo crate is not shared');
  assert.equal(cleanRecord({ id: 'discogs_5', title: '', artist: 'X' }), null, 'no title, no entry');
  assert.equal(cleanRecord(null), null);
  assert.equal(cleanRecord(rec(2, { artwork: { highRes: 'javascript:alert(1)', thumbnail: 'http://insecure/x.jpg' } })).artwork.highRes, '', 'only https pictures');
  assert.equal(cleanRecord(rec(3, { title: 'x'.repeat(500) })).title.length, 200, 'long text is cut');
  assert.equal(cleanRecord(rec(4, { year: 'soon' })).year, undefined, 'a bad year is dropped');
  assert.equal(cleanRecord(rec(5, { genres: Array.from({ length: 40 }, (_, i) => `g${i}`) })).genres.length, 12);
  assert.equal(cleanRecords(Array.from({ length: MAX_RECORDS + 50 }, (_, i) => rec(i + 1))).length, MAX_RECORDS, 'a ceiling on size');
  assert.deepEqual(cleanRecords('nope'), []);
  const id = newShareId();
  assert.ok(SHARE_ID.test(id), 'an unguessable 20-character address');
  assert.notEqual(newShareId(), id);
}

// ---- without a namespace, the feature says so --------------------------------------------------------------------
{
  const bare = { SESSION_SECRET: 'test-secret' };
  assert.deepEqual(await (await status({ request: request('GET'), env: bare })).json(), { available: false });
  assert.equal((await publish({ request: request('POST', { body: { records: [rec(1)] } }), env: bare })).status, 501);
  assert.equal((await read({ params: { id: 'a'.repeat(20) }, env: bare })).status, 404);
}

// ---- publishing --------------------------------------------------------------------------------------------------
{
  assert.deepEqual(await (await status({ request: request('GET', { signedIn: false }), env })).json(), { available: true, signedIn: false, shared: null });
  assert.equal((await publish({ request: request('POST', { body: { records: [rec(1)] }, signedIn: false }), env })).status, 401, 'only a signed-in owner may publish');
  assert.equal((await publish({ request: request('POST', { body: { records: [rec(1)] }, headers: { 'Sec-Fetch-Site': 'cross-site' } }), env })).status, 403, 'only this site may publish');
  assert.equal((await publish({ request: request('POST', { body: '{not json' }), env })).status, 400);
  assert.equal((await publish({ request: request('POST', { body: { records: [] } }), env })).status, 400, 'nothing to share');
  assert.equal((await publish({ request: request('POST', { body: { records: [{ id: 'discogs_mock_001', title: 'Demo', artist: 'D' }] } }), env })).status, 400, 'only demo records: nothing to share');
  assert.equal((await publish({ request: request('POST', { body: '{}', headers: { 'Content-Length': '99999999' } }), env })).status, 413, 'too large');

  const first = await (await publish({ request: request('POST', { body: { records: [rec(1), rec(2)] } }), env })).json();
  assert.ok(SHARE_ID.test(first.shared.id));
  assert.equal(first.shared.url, `${ORIGIN}/s/${first.shared.id}`);
  assert.equal(first.shared.count, 2);

  const again = await (await publish({ request: request('POST', { body: { records: [rec(1), rec(2), rec(3)] } }), env })).json();
  assert.equal(again.shared.id, first.shared.id, 'republishing keeps the same link');
  assert.equal(again.shared.count, 3);

  const st = await (await status({ request: request('GET'), env })).json();
  assert.equal(st.shared.id, first.shared.id, 'the owner can see their link');
  assert.equal(st.shared.count, 3);

  // ---- reading it ------------------------------------------------------------------------------------------------
  const res = await read({ params: { id: first.shared.id }, env });
  assert.equal(res.status, 200, 'anyone with the link may read it');
  const snapshot = await res.json();
  assert.equal(snapshot.owner, 'Ryan');
  assert.equal(snapshot.records.length, 3);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  assert.ok(res.headers.get('Cache-Control').includes('public'));
  assert.equal((await read({ params: { id: 'short' }, env })).status, 404, 'a malformed address is refused before any lookup');
  assert.equal((await read({ params: { id: 'z'.repeat(20) }, env })).status, 404, 'an unknown one is not found');

  // ---- someone else cannot touch it ------------------------------------------------------------------------------
  const other = `${SESSION_COOKIE}=${await seal(env, { u: 'Someone', t: 'x', s: 'y' }, 3600)}`;
  const theirs = await (await status({ request: request('GET', { headers: { Cookie: other }, signedIn: false }), env })).json();
  assert.equal(theirs.shared, null, 'another user sees none of it');
  assert.equal((await remove({ request: request('DELETE', { signedIn: false }), env })).status, 401);

  // ---- removing it -----------------------------------------------------------------------------------------------
  assert.equal((await remove({ request: request('DELETE', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), env })).status, 403);
  assert.deepEqual(await (await remove({ request: request('DELETE'), env })).json(), { shared: null });
  assert.equal((await read({ params: { id: first.shared.id }, env })).status, 404, 'the link stops working');
  assert.equal((await (await status({ request: request('GET'), env })).json()).shared, null);
}

// ---- the page's side: addresses and what it sends -----------------------------------------------------------------
{
  const id = 'abcdefghij0123456789';
  assert.equal(shareIdFromPath(`/s/${id}`), id);
  assert.equal(shareIdFromPath(`/s/${id}/`), id);
  assert.equal(shareIdFromPath(`/s/${id}/album/afi/black-sails/`), id, 'an album inside a shared crate');
  assert.equal(shareIdFromPath('/s/short'), null);
  assert.equal(shareIdFromPath(`/s/${id.toUpperCase()}`), null, 'lowercase only');
  assert.equal(shareIdFromPath(`/x/s/${id}`), null);
  assert.equal(shareIdFromPath('/album/afi/x/'), null);
  assert.equal(shareIdFromPath('/'), null);

  const sent = buildSnapshot([rec(1), { ...rec(2), id: 'discogs_mock_001' }, null]);
  assert.equal(sent.length, 1, 'the demo crate and empty entries are left out');
  const text = JSON.stringify(sent);
  assert.ok(!text.includes('PRIVATE') && !text.includes('wikiTitle') && !text.includes('credits'), 'personal and gathered fields are never even sent');
  assert.equal(sent[0].details.formats[0].text, 'Red', 'what is needed for tags and filters is');
  assert.equal(cleanRecords(sent).length, 1, 'and the server accepts it');

  assert.equal(shareIsStale('2026-01-01T00:00:00Z', Date.parse('2026-01-01T12:00:00Z')), false);
  assert.equal(shareIsStale('2026-01-01T00:00:00Z', Date.parse('2026-01-03T00:00:00Z')), true, 'republished daily');
  assert.equal(shareIsStale(undefined), true);
}

console.log('Share tests passed.');

// Unit tests for the pure logic that decides what the album page shows: credits, album matching, placeholders.
import assert from 'node:assert/strict';
import {
  splitCreditRoles, creditKinds, groupCredits, parseCollectionFields, mapDiscogsTracklist, parseReleaseDetails,
  normalizeItunesGenre, getGenreTags, getRecordTags, tagLabel, calculateTotalDuration,
} from '../public/js/sync.js';
import { pickAlbumPage, isVariousArtists, pickBackCoverReleases, pickReleaseGroup } from '../public/js/wiki.js';
import { usefulValue } from '../public/js/values.js';
import { pickDeezerAlbum, pickDeezerCover, normalize as deezerNormalize } from '../functions/_lib/deezer.js';

// ---- credit roles ---------------------------------------------------------------------------------------------
assert.deepEqual(splitCreditRoles('Producer, Engineer [Assistant, Studio X], Guitar'), [
  { base: 'Producer', detail: '' },
  { base: 'Engineer', detail: 'Assistant, Studio X' },
  { base: 'Guitar', detail: '' },
], 'commas inside brackets do not split a role');
assert.deepEqual(splitCreditRoles(''), []);
assert.deepEqual(splitCreditRoles(undefined), []);

assert.deepEqual([...creditKinds('Written-By')], ['writer']);
assert.deepEqual([...creditKinds('Producer, Written-By')].sort(), ['producer', 'writer']);
assert.deepEqual([...creditKinds('Producer [Assistant]')], [], 'an assistant is not a producer');
assert.deepEqual([...creditKinds('Guitar')], []);

const details = {
  credits: [
    { id: 1, name: 'Ann', role: 'Vocals, Guitar, Written-By' },
    { id: 2, name: 'Bo', role: 'Producer, Engineer' },
    { id: 3, name: 'Cy', role: 'Engineer [Assistant]' },
    { id: 4, name: 'Di', role: 'Management' },
    { id: 5, name: 'Ed', role: 'Photography By, Design' },
    { id: 6, name: 'Flo', role: 'Theremin' },
    { id: 7, name: 'Gus', role: 'Bass [Additional]' },
    { id: 1, name: 'Ann', role: 'Mixed By' },
  ],
};
const groups = groupCredits(details);
const byTitle = Object.fromEntries(groups.map((g) => [g.title, g]));
assert.deepEqual(groups.map((g) => g.title), ['Performed by', 'Written & arranged', 'Produced & engineered', 'Artwork & photography']);
assert.deepEqual(byTitle['Performed by'].people.map((p) => p.name), ['Ann', 'Flo', 'Gus'], 'unknown instruments count as performing');
assert.deepEqual(byTitle['Performed by'].people[2].roles, ['Bass (additional)'], 'additional is kept');
assert.deepEqual(byTitle['Produced & engineered'].people.map((p) => p.name), ['Bo', 'Cy', 'Ann']);
assert.deepEqual(byTitle['Produced & engineered'].people[1].roles, ['Assistant engineer']);
assert.ok(!JSON.stringify(groups).includes('Di'), 'business roles are dropped');
assert.equal(byTitle['Performed by'].people.filter((p) => p.name === 'Ann').length, 1, 'a person appears once per group');
assert.deepEqual(groupCredits({}), []);
assert.deepEqual(groupCredits(undefined), []);

// ---- Wikipedia album matching ---------------------------------------------------------------------------------
const wiki = (title, description) => ({ title, description });
assert.equal(pickAlbumPage([wiki('Bodies (AFI album)', '2021 studio album by AFI')], 'AFI', 'Bodies'), 'Bodies (AFI album)');
assert.equal(pickAlbumPage([wiki('Bodies (film)', '2023 film'), wiki('Bodies (AFI album)', '2021 studio album by AFI')], 'AFI', 'Bodies'), 'Bodies (AFI album)');
assert.equal(pickAlbumPage([wiki('Bodies (Sex Pistols song)', 'song by Sex Pistols')], 'AFI', 'Bodies'), null, 'a song is not the album');
assert.equal(pickAlbumPage([wiki('Bodies (Some Band album)', '2001 album by Some Band')], 'AFI', 'Bodies'), null, 'another artist\'s album of the same name');
assert.equal(pickAlbumPage([wiki('The 56th Annual Grammy Awards', 'award ceremony')], 'Various', "Ryan & Maura's Wedding Record"), null, 'a homemade record finds nothing');
assert.equal(pickAlbumPage([wiki('Heartbeat City', '1984 studio album by the Cars')], 'The Cars', 'Heartbeat City'), 'Heartbeat City', 'leading "The" is ignored');
assert.equal(pickAlbumPage([wiki('Selected Ambient Works 85–92', '1992 studio album by Aphex Twin')], 'Aphex Twin', 'Selected Ambient Works 85-92'), 'Selected Ambient Works 85–92', 'dash styles do not matter');
assert.equal(pickAlbumPage([wiki('Now That\'s What I Call Music! 50', 'compilation album by Various artists')], 'Various', "Now That's What I Call Music! 50"), "Now That's What I Call Music! 50", 'compilations match without an artist');
assert.equal(pickAlbumPage([wiki('Emotion (Carly Rae Jepsen album)', '2015 studio album by Carly Rae Jepsen')], 'Carly Rae Jepsen', 'Emotion (Deluxe)'), 'Emotion (Carly Rae Jepsen album)', 'edition suffixes are ignored');
assert.equal(pickAlbumPage([], 'AFI', 'Bodies'), null);
assert.equal(pickAlbumPage(undefined, 'AFI', 'Bodies'), null);
assert.equal(pickAlbumPage([wiki('Anything', 'album by X')], 'X', ''), null);

assert.equal(isVariousArtists('Various'), true);
assert.equal(isVariousArtists('Various Artists'), true);
assert.equal(isVariousArtists('  various  '), true);
assert.equal(isVariousArtists('Various Production'), false, 'a real act with "Various" in its name');
assert.equal(isVariousArtists(''), false);

// ---- Deezer matching ------------------------------------------------------------------------------------------
const dz = (title, artist, link) => ({ title, artist: { name: artist }, link });
assert.equal(pickDeezerAlbum([dz('Antibodies', 'Tensnake', 'x'), dz('Bodies', 'AFI', 'https://deezer/1')], 'AFI', 'Bodies'), 'https://deezer/1');
assert.equal(pickDeezerAlbum([dz('Bodies', 'Someone Else', 'x')], 'AFI', 'Bodies'), null, 'same title, different artist');
assert.equal(pickDeezerAlbum([dz('Bodies (Deluxe Edition)', 'AFI', 'https://deezer/2')], 'AFI', 'Bodies'), 'https://deezer/2', 'editions match');
assert.equal(pickDeezerAlbum([dz('Heartbeat City', 'The Cars', 'https://deezer/3')], 'Cars', 'Heartbeat City'), 'https://deezer/3', '"The" is ignored');
assert.equal(pickDeezerAlbum([dz('Compilation', 'Various Artists', 'https://deezer/4')], 'Various', 'Compilation'), 'https://deezer/4');
assert.equal(pickDeezerAlbum([], 'AFI', 'Bodies'), null);
assert.equal(pickDeezerAlbum(undefined, 'AFI', 'Bodies'), null);
assert.equal(pickDeezerAlbum([dz('Bodies', 'AFI', 'x')], 'AFI', ''), null);
assert.equal(deezerNormalize('Sigur Rós & Friends [Remastered]'), 'sigur ros and friends');

// ---- placeholders ---------------------------------------------------------------------------------------------
for (const empty of ['None', 'none', ' Not On Label ', 'Not On Label (Ryan March Self-released)', 'Unknown', 'N/A', 'n/a', '-', '?', '', null, undefined]) {
  assert.equal(usefulValue(empty), '', `"${empty}" is not a value`);
}
assert.equal(usefulValue('Apollo'), 'Apollo');
assert.equal(usefulValue('  Rise Records '), 'Rise Records');
assert.equal(usefulValue('None of the Above'), 'None of the Above', 'only whole-word placeholders');

// ---- Discogs data ---------------------------------------------------------------------------------------------
const fieldNames = new Map([[1, 'Media Condition'], [2, 'Sleeve Condition'], [3, 'Notes']]);
assert.deepEqual(parseCollectionFields([
  { field_id: 3, value: 'Signed' }, { field_id: 1, value: 'Mint (M)' }, { field_id: 2, value: 'Near Mint (NM or M-)' }, { field_id: 9, value: '' },
], fieldNames), {
  mediaCondition: 'Mint (M)', sleeveCondition: 'Near Mint (NM or M-)', collectionNotes: [{ name: 'Notes', value: 'Signed' }],
}, 'fields are read by name, not by position');
assert.deepEqual(parseCollectionFields(undefined, fieldNames), { mediaCondition: '', sleeveCondition: '', collectionNotes: [] });

assert.deepEqual(mapDiscogsTracklist([
  { position: 'A1', title: 'One', duration: '3:00' }, { type_: 'heading', title: 'Side B' }, { title: 'Two', duration: '' }, { position: 'B1' },
]), [{ position: 'A1', title: 'One', duration: '3:00' }, { position: '2', title: 'Two', duration: '' }], 'headings and untitled rows are dropped');

const parsed = parseReleaseDetails({
  labels: [{ name: 'Rise Records (2)', catno: 'RISE-1' }, { name: 'Rise Records', catno: 'none' }, { name: 'Rise Records (2)', catno: 'RISE-1' }],
  extraartists: [{ id: 1, name: 'Ann (3)', role: 'Vocals' }, { id: 2, name: '', role: 'Guitar' }, { id: 3, name: 'Bo', role: '' }],
});
assert.deepEqual(parsed.labels.map((l) => l.name), ['Rise Records', 'Rise Records'], 'disambiguation numbers are stripped');
assert.equal(parsed.labels[0].catno, 'RISE-1');
assert.equal(parsed.labels[1].catno, '', '"none" is not a catalogue number');
assert.deepEqual(parsed.credits.map((c) => c.name), ['Ann'], 'credits need a name and a role');

// ---- genres and tags ------------------------------------------------------------------------------------------
assert.equal(normalizeItunesGenre('Pop'), 'Pop');
assert.equal(normalizeItunesGenre('Totally Made Up'), null);
assert.equal(normalizeItunesGenre(''), null);
assert.deepEqual(getGenreTags({ primaryGenre: 'Pop', genres: ['Electronic', 'pop'] }), ['Pop', 'Electronic'], 'primary genre first, no duplicates');
assert.deepEqual(getRecordTags({ genres: ['Rock'], styles: ['Goth Rock', 'Rock'] }), ['Rock', 'Goth Rock']);
assert.equal(tagLabel('Funk / Soul'), 'Soul & Funk');
assert.equal(tagLabel('Jazz'), 'Jazz');

// ---- durations ------------------------------------------------------------------------------------------------
assert.equal(calculateTotalDuration([]), null);
assert.equal(calculateTotalDuration([{ duration: '3:00' }, { duration: '2:00' }]), '5 min');

console.log('Logic tests passed.');

// ---- Discogs request queue ------------------------------------------------------------------------------------
import { createLimiter, retryAfterMs } from '../public/js/limiter.js';

{
  // Fake clock: sleeping just advances time, so the test runs instantly
  let t = 0;
  const clock = { now: () => t, sleep: async (ms) => { t += ms; } };
  const res = (status, headers = {}) => ({ status, headers: { get: (k) => headers[k] ?? null } });

  // Requests run one at a time, spaced by pace(), and 'high' jumps ahead of 'low'
  const order = [];
  const starts = [];
  const limiter = createLimiter({ pace: () => 1000, ...clock });
  const run = (name, priority) => limiter.schedule(async () => { order.push(name); starts.push(t); return res(200); }, priority);
  await Promise.all([run('low1', 'low'), run('low2', 'low'), run('high1', 'high'), run('low3', 'low')]);
  assert.deepEqual(order, ['low1', 'high1', 'low2', 'low3'], 'the first job starts at once, then high beats low');
  assert.deepEqual(starts.slice(1).map((s, i) => s - starts[i]), [1000, 1000, 1000], 'requests are spaced by pace()');

  // A 429 pauses the queue, honours Retry-After, and the caller only sees the eventual success
  t = 0;
  let calls = 0;
  const throttled = createLimiter({ pace: () => 0, ...clock });
  const out = await throttled.schedule(async () => (++calls === 1 ? res(429, { 'retry-after': '20' }) : res(200)));
  assert.equal(out.status, 200);
  assert.equal(calls, 2);
  assert.ok(t >= 20000, 'waited out Retry-After');

  // It gives up after maxRetries and hands back the 429
  calls = 0;
  const stubborn = createLimiter({ pace: () => 0, maxRetries: 2, ...clock });
  const last = await stubborn.schedule(async () => { calls++; return res(429); });
  assert.equal(last.status, 429);
  assert.equal(calls, 3, 'one try plus two retries');

  // A thrown request rejects that caller without stalling the queue
  const flaky = createLimiter({ pace: () => 0, ...clock });
  const bad = flaky.schedule(async () => { throw new Error('offline'); });
  const good = flaky.schedule(async () => res(200));
  await assert.rejects(bad, /offline/);
  assert.equal((await good).status, 200);

  // Subscribers hear about the queue, and the pause shows up in the stats
  const seen = [];
  const watched = createLimiter({ pace: () => 0, ...clock });
  watched.subscribe((s) => seen.push(s));
  let n = 0;
  await watched.schedule(async () => (++n === 1 ? res(429, { 'retry-after': '5' }) : res(200)), 'low');
  assert.ok(seen.some((s) => s.low === 1), 'reports queued background work');
  assert.ok(seen.some((s) => s.pausedUntil > 0), 'reports the pause');
  assert.equal(seen.at(-1).pending, 0, 'ends idle');

  assert.equal(retryAfterMs(res(429)), 30000, 'default wait');
  assert.equal(retryAfterMs(res(429, { 'retry-after': '500' })), 60000, 'capped');
  console.log('Discogs queue tests passed.');
}

// A free answer (a cache hit) skips the wait before the next request
{
  let t = 0;
  const limiter = createLimiter({ pace: (res) => (res.status === 203 ? 0 : 1000), now: () => t, sleep: async (ms) => { t += ms; } });
  const starts = [];
  const run = (status) => limiter.schedule(async () => { starts.push(t); return { status, headers: { get: () => null } }; });
  await Promise.all([run(203), run(200), run(200)]);
  assert.deepEqual(starts, [0, 0, 1000], 'no wait after a cache hit, a full wait after a real request');
}

// ---- which year a record files under ---------------------------------------------------------------------------
import { sortYear, masterYearUpdates, itunesYearUpdates, isEditionTitle } from '../public/js/years.js';

{
  // A 2023 vinyl issue of a 1999 album files under 1999 once its master is known
  const reissue = { title: 'Millennium', pressingYear: 2023, year: 2023, originalYear: null, masterYear: null };
  assert.equal(sortYear(reissue), 2023, 'before the master is known it files under the pressing');
  const updates = masterYearUpdates(reissue, { title: 'Millennium', year: 1999 });
  assert.deepEqual(updates, { masterYear: 1999, originalYear: 1999, year: 1999, masterChecked: true });
  assert.equal(sortYear({ ...reissue, ...updates }), 1999);

  // Special editions keep their own year
  const deluxe = { title: 'Millennium (Deluxe)', pressingYear: 2023, year: 2023 };
  const kept = masterYearUpdates(deluxe, { title: 'Millennium', year: 1999 });
  assert.equal(kept.year, 2023);
  assert.equal(sortYear({ ...deluxe, ...kept }), 2023, 'a deluxe edition files under its pressing year');

  // A master with no year is marked checked so it is not asked for again
  assert.deepEqual(masterYearUpdates(reissue, { title: 'X', year: 0 }), { masterChecked: true });

  assert.equal(isEditionTitle('Abbey Road 50th Anniversary'), true);
  assert.equal(isEditionTitle('Abbey Road'), false);

  // iTunes dates only fill gaps: never for a record with a master, and never later than what we have
  assert.deepEqual(itunesYearUpdates({ masterId: 5, pressingYear: 2023, year: 2023 }, 1999), {}, 'the master decides');
  assert.deepEqual(itunesYearUpdates({ pressingYear: 1975, year: 1975 }, 2011), {}, "a remaster's date never pushes an album later");
  assert.deepEqual(itunesYearUpdates({ pressingYear: 2023, year: 2023 }, 1999), { originalYear: 1999, year: 1999 });
  assert.deepEqual(itunesYearUpdates({ pressingYear: 2023, year: 2023 }, NaN), {});
}

// ---- stale release details ---------------------------------------------------------------------------------------
import { detailsAreStale } from '../public/js/sync.js';

{
  const now = Date.parse('2026-09-24T00:00:00Z');
  const day = 86400000;
  assert.equal(detailsAreStale({}, now), false, 'nothing saved yet is missing, not stale');
  assert.equal(detailsAreStale({ details: { fetchedAt: new Date(now - 5 * day).toISOString() } }, now), false);
  assert.equal(detailsAreStale({ details: { fetchedAt: new Date(now - 31 * day).toISOString() } }, now), true);
  assert.equal(detailsAreStale({ details: {} }, now), true, 'no timestamp counts as stale');
}

// ---- artwork choices -------------------------------------------------------------------------------------------
{
  // Back covers: a cassette insert is never the answer for a record collection, and vinyl beats CD
  const rel = (id, format, back = true) => ({ id, media: [{ format }], 'cover-art-archive': { back } });
  const picked = pickBackCoverReleases([rel('tape', 'Cassette'), rel('cd', 'CD'), rel('lp', '12" Vinyl'), rel('none', '12" Vinyl', false), rel('web', 'Digital Media')]);
  assert.deepEqual(picked.map((r) => r.id), ['lp', 'cd'], 'vinyl first, then CD; cassette, digital and releases without a back are dropped');
  assert.deepEqual(pickBackCoverReleases([rel('tape', 'Cassette')]), [], 'only a cassette insert means no back cover');
  assert.deepEqual(pickBackCoverReleases([{ id: 'x', 'cover-art-archive': { back: true } }]).map((r) => r.id), ['x'], 'unknown format is kept, last');

  // The release group is the album, not a "Demos" edition that outranked it in search
  assert.equal(pickReleaseGroup([{ id: 'demos', title: 'Transatlanticism Demos' }, { id: 'album', title: 'Transatlanticism' }], 'Transatlanticism').id, 'album');
  assert.equal(pickReleaseGroup([{ id: 'only', title: 'Something Else' }], 'Nope').id, 'only', 'falls back to the first hit');
  assert.equal(pickReleaseGroup([], 'x'), null);

  // Deezer covers come only from an exact artist and title match
  const dzc = (title, artist, cover) => ({ title, artist: { name: artist }, link: 'l', cover_xl: cover });
  assert.equal(pickDeezerCover([dzc('Transatlanticism', 'Ben Freeman', 'wrong'), dzc('Transatlanticism', 'Death Cab For Cutie', 'right')], 'Death Cab for Cutie', 'Transatlanticism'), 'right');
  assert.equal(pickDeezerCover([dzc('Bodies', 'Someone Else', 'x')], 'AFI', 'Bodies'), null);
}

// ---- how much of the collection a sync reads ---------------------------------------------------------------------
import { needsFullSync, canStopEarly, readSyncMeta, writeSyncMeta, removedRecordIds } from '../public/js/syncplan.js';
import { allowedUpstream } from '../functions/_lib/proxy.js';

{
  const day = 86400000;
  const now = Date.parse('2026-09-24T00:00:00Z');
  assert.equal(needsFullSync({ storedTotal: null, lastFullAt: 0 }, now), true, 'the first sync reads everything');
  assert.equal(needsFullSync({ storedTotal: 200, lastFullAt: now - 3 * day }, now), false);
  assert.equal(needsFullSync({ storedTotal: 200, lastFullAt: now - 20 * day }, now), true, 'a full read every two weeks picks up edits');
  assert.equal(needsFullSync({ storedTotal: 200, lastFullAt: now - day }, now, true), true, 'forced');

  // stop at a page with known records only when the totals add up
  assert.equal(canStopEarly({ pageHasKnown: true, storedTotal: 200, total: 203, newCount: 3 }), true);
  assert.equal(canStopEarly({ pageHasKnown: true, storedTotal: 200, total: 203, newCount: 2 }), false, 'a second copy of a known release does not add up');
  assert.equal(canStopEarly({ pageHasKnown: true, storedTotal: 200, total: 199, newCount: 0 }), false, 'a removed record does not add up');
  assert.equal(canStopEarly({ pageHasKnown: false, storedTotal: 200, total: 203, newCount: 3 }), false, 'the whole page is new: keep reading');
  assert.equal(canStopEarly({ pageHasKnown: true, storedTotal: null, total: 3, newCount: 3 }), false);

  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(readSyncMeta('Ryan', storage), { storedTotal: null, lastFullAt: 0 });
  writeSyncMeta('Ryan', { storedTotal: 210, lastFullAt: 5 }, storage);
  assert.deepEqual(readSyncMeta('ryan', storage), { storedTotal: 210, lastFullAt: 5 }, 'usernames are not case sensitive');
  assert.deepEqual(readSyncMeta('x', { getItem() { throw new Error('blocked'); } }), { storedTotal: null, lastFullAt: 0 }, 'blocked storage just means a full read');

  // the proxy passes a newest-first sort, and only sorts it knows
  const session = { u: 'Ryan' };
  const path = 'users/Ryan/collection/folders/0/releases';
  assert.equal(allowedUpstream(path, new URLSearchParams('page=1&per_page=100&sort=added&sort_order=desc&evil=1'), session), '/users/Ryan/collection/folders/0/releases?page=1&per_page=100&sort=added&sort_order=desc');
  assert.equal(allowedUpstream(path, new URLSearchParams('sort=../../x&sort_order=sideways'), session), '/users/Ryan/collection/folders/0/releases', 'unknown sort values are dropped');
}

// ---- removing records that left the Discogs collection ------------------------------------------------------------
{
  const local = [{ id: 'discogs_1' }, { id: 'discogs_2' }, { id: 'discogs_3' }, { id: 'discogs_mock_9' }, { id: 'custom_1' }];
  assert.deepEqual(removedRecordIds(local, ['discogs_1', 'discogs_3'], { total: 2, fetchedCount: 2 }), ['discogs_2'], 'only the missing Discogs record goes; demo and local records stay');
  assert.deepEqual(removedRecordIds(local, [], { total: 0, fetchedCount: 0 }), [], 'an empty answer never wipes the crate');
  assert.deepEqual(removedRecordIds(local, ['discogs_1'], { total: 5, fetchedCount: 1 }), [], 'a partial read deletes nothing');
  assert.deepEqual(removedRecordIds(local, ['discogs_1', 'discogs_1'], { total: 2, fetchedCount: 2 }), ['discogs_2', 'discogs_3'], 'two copies of one release count as two items');
  assert.deepEqual(removedRecordIds(local, ['discogs_1'], { total: null, fetchedCount: 1 }), [], 'no total reported, no deletion');
}

// ---- collection stats --------------------------------------------------------------------------------------------
import { computeStats, durationSeconds, colorGroup } from '../public/js/stats.js';

{
  assert.equal(durationSeconds('3:02'), 182);
  assert.equal(durationSeconds('1:02:03'), 3723);
  assert.equal(durationSeconds(''), 0);
  assert.equal(durationSeconds('n/a'), 0);

  const rec = (id, artist, year, extra = {}) => ({ id, artist, title: id, year, genres: ['Rock'], dateAdded: '2021-03-05T00:00:00Z', tracklist: [{ duration: '10:00' }], ...extra });
  const records = [
    rec('a', 'AFI', 1999, { genres: ['Punk'], details: { formats: [{ name: 'Vinyl', descriptions: ['LP'], text: 'Black' }] } }),
    rec('b', 'AFI', 2003, { genres: ['Punk'], dateAdded: '2021-03-20T00:00:00Z', details: { formats: [{ name: 'Vinyl', descriptions: ['LP'], text: 'Red Marbled' }] } }),
    rec('c', 'Miles Davis', 1959, { genres: ['Jazz'], dateAdded: '2022-01-02T00:00:00Z' }),
    rec('d', 'Various', 1985, { genres: [], dateAdded: 'not a date' }),
    rec('discogs_mock_1', 'Demo', 1970),
  ];
  const s = computeStats(records);
  assert.equal(s.total, 4, 'demo records are left out when real ones exist');
  assert.equal(s.artistCount, 2, '"Various" is not an artist');
  assert.deepEqual(s.topArtists[0], { name: 'AFI', count: 2 });
  assert.deepEqual(s.decades.map((d) => [d.name, d.count]), [['1950s', 1], ['1980s', 1], ['1990s', 1], ['2000s', 1]]);
  assert.equal(s.oldest.year, 1959);
  assert.equal(s.newest.year, 2003);
  assert.equal(s.genres.reduce((sum, g) => sum + g.count, 0), 4, 'genre bars add up to the collection');
  assert.ok(s.genres.some((g) => g.name === 'Unfiled'), 'a record with no genre is unfiled, not dropped');
  assert.deepEqual(s.colors.map((c) => [c.name, c.count]).sort(), [['Black', 1], ['Marbled', 1]]);
  assert.deepEqual(s.colorCoverage, { known: 2, total: 4 }, 'colours are only known once details have loaded');
  assert.equal(s.runtimeSeconds, 4 * 600);
  assert.deepEqual(s.growth, [{ month: '2021-03', added: 2, total: 2 }, { month: '2022-01', added: 1, total: 3 }], 'growth is cumulative and skips bad dates');

  // a demo-only crate still gets stats
  assert.equal(computeStats([rec('discogs_mock_1', 'Demo', 1970)]).total, 1);
  assert.equal(computeStats([]).total, 0);
  assert.equal(colorGroup({ kind: 'translucent' }), 'Clear');

  // the proxy allows the signed-in user's collection value, and only theirs
  const session = { u: 'Ryan' };
  assert.equal(allowedUpstream('users/Ryan/collection/value', new URLSearchParams(), session), '/users/Ryan/collection/value');
  assert.equal(allowedUpstream('users/someoneelse/collection/value', new URLSearchParams(), session), null);
}

// ---- reading outside sources: failures are not answers -----------------------------------------------------------
import { externalFetch, externalJSON } from '../public/js/external.js';
import { fetchBackCover } from '../public/js/wiki.js';

{
  const realFetch = globalThis.fetch;
  const proxied = (body, { status = 200, hit = true } = {}) => new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'x-spindex-proxy': '1', ...(hit ? { 'x-spindex-cache': 'HIT' } : {}) },
  });
  try {
    // goes through the proxy, and falls back to the source when there is no server behind it
    const seen = [];
    globalThis.fetch = async (url) => { seen.push(String(url)); return String(url).startsWith('/api/ext') ? proxied({ ok: 1 }) : new Response('{}'); };
    await externalFetch('https://en.wikipedia.org/w/api.php?x=1');
    assert.equal(seen[0], `/api/ext?url=${encodeURIComponent('https://en.wikipedia.org/w/api.php?x=1')}`);
    seen.length = 0;
    await externalFetch('https://itunes.apple.com/search?term=a');
    assert.equal(seen[0], 'https://itunes.apple.com/search?term=a', 'sources outside the list are not proxied');
    seen.length = 0;
    globalThis.fetch = async (url) => { seen.push(String(url)); return String(url).startsWith('/api/ext') ? new Response('<html>not found</html>', { status: 404 }) : new Response('{"direct":true}'); };
    assert.deepEqual(await (await externalFetch('https://en.wikipedia.org/w/api.php')).json(), { direct: true }, 'no proxy answering: go direct');

    // 404 is "not there"; anything else wrong throws
    globalThis.fetch = async () => proxied({}, { status: 404 });
    assert.equal(await externalJSON('https://coverartarchive.org/release/x'), null);
    globalThis.fetch = async () => proxied({}, { status: 503 });
    await assert.rejects(externalJSON('https://coverartarchive.org/release/x'), /503/);

    // a back cover lookup: found, genuinely absent, and "couldn't ask" are three different outcomes
    const mbGroup = { 'release-groups': [{ id: 'g1', title: 'Transatlanticism' }] };
    const mbReleases = { releases: [{ id: 'r1', media: [{ format: '12" Vinyl' }], 'cover-art-archive': { back: true } }] };
    const caa = { images: [{ types: ['Back'], approved: true, thumbnails: { 1200: 'http://img/back-1200.jpg' } }] };
    const route = (url) => {
      const target = decodeURIComponent(String(url).split('url=')[1]);
      if (target.includes('release-group?')) return proxied(mbGroup);
      if (target.includes('/release?')) return proxied(mbReleases);
      return proxied(caa);
    };
    globalThis.fetch = async (url) => route(url);
    assert.equal(await fetchBackCover('Death Cab for Cutie', 'Transatlanticism'), 'https://img/back-1200.jpg', 'found (and upgraded to https)');

    globalThis.fetch = async (url) => (decodeURIComponent(String(url)).includes('release-group?') ? proxied({ 'release-groups': [] }) : route(url));
    assert.equal(await fetchBackCover('Nobody', 'Nothing'), null, 'MusicBrainz has no such album: no back cover');

    globalThis.fetch = async (url) => (decodeURIComponent(String(url)).includes('/release?') ? proxied({}, { status: 502 }) : route(url));
    await assert.rejects(fetchBackCover('Death Cab for Cutie', 'Transatlanticism'), /502/, 'a source failing is thrown, never recorded as "no back cover"');
  } finally {
    globalThis.fetch = realFetch;
  }
}

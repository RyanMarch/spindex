// Unit tests for the pure logic that decides what the album page shows: credits, album matching, placeholders.
import assert from 'node:assert/strict';
import {
  splitCreditRoles, creditKinds, groupCredits, parseCollectionFields, mapDiscogsTracklist, parseReleaseDetails,
  normalizeItunesGenre, getGenreTags, getRecordTags, tagLabel, calculateTotalDuration,
} from '../public/js/sync.js';
import { pickAlbumPage, isVariousArtists, pickBackCoverReleases, pickReleaseGroup, infoboxField } from '../public/js/wiki.js';
import { usefulValue, isCustomRelease } from '../public/js/values.js';
import { pickDeezerAlbum, pickDeezerCover, searchTitle, normalize as deezerNormalize } from '../functions/_lib/deezer.js';

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
  assert.deepEqual(updates, { masterYear: 1999, originalYear: 1999, year: 1999, masterChecked: true, masterTitle: 'Millennium' });
  assert.equal(sortYear({ ...reissue, ...updates }), 1999);

  // Special editions keep their own year
  const deluxe = { title: 'Millennium (Deluxe)', pressingYear: 2023, year: 2023 };
  const kept = masterYearUpdates(deluxe, { title: 'Millennium', year: 1999 });
  assert.equal(kept.year, 2023);
  assert.equal(sortYear({ ...deluxe, ...kept }), 2023, 'a deluxe edition files under its pressing year');

  // A master with no year is marked checked so it is not asked for again
  assert.deepEqual(masterYearUpdates(reissue, { title: 'X', year: 0 }), { masterChecked: true, masterTitle: 'X' });

  assert.equal(isEditionTitle('Abbey Road 50th Anniversary'), true);
  assert.equal(isEditionTitle('Abbey Road'), false);

  // iTunes dates only fill gaps: never for a record with a master, and never later than what we have
  assert.deepEqual(itunesYearUpdates({ masterId: 5, pressingYear: 2023, year: 2023 }, 1999), {}, 'the master decides');
  assert.deepEqual(itunesYearUpdates({ pressingYear: 1975, year: 1975 }, 2011), {}, "a remaster's date never pushes an album later");
  assert.deepEqual(itunesYearUpdates({ pressingYear: 2023, year: 2023 }, 1999), { originalYear: 1999, year: 1999 });
  assert.deepEqual(itunesYearUpdates({ pressingYear: 2023, year: 2023 }, NaN), {});
}

// ---- stale release details ---------------------------------------------------------------------------------------
import { detailsAreStale, needsDeezerArt, needsItunesArt, buildCollectionRecord, scoreAlbumMatch, ART_SEARCH_VERSION, needsMasterTitleArt, titlesDiffer, needsDetails } from '../public/js/sync.js';

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

// ---- which artwork lookups a record still needs ------------------------------------------------------------------
{
  const photo = { id: 'discogs_1', artwork: { source: 'discogs' } };
  const searched = { deezerSearchVersion: ART_SEARCH_VERSION, itunesSearchVersion: ART_SEARCH_VERSION };
  assert.equal(needsDeezerArt(photo), true, 'a Discogs photo asks Deezer first');
  assert.equal(needsItunesArt(photo), true, 'and iTunes takes whatever is left');
  assert.equal(needsDeezerArt({ ...photo, deezerSearchVersion: ART_SEARCH_VERSION }), false, 'Deezer answered (a miss counts): not asked again');
  assert.equal(needsItunesArt({ ...photo, deezerSearchVersion: ART_SEARCH_VERSION }), true, 'a Deezer miss still goes to iTunes');
  assert.equal(needsItunesArt({ ...photo, ...searched }), false, 'both answered: nothing left to try');
  assert.equal(needsDeezerArt({ ...photo, deezerChecked: true, artChecked: true }), true, 'a miss recorded under the old, weaker matching is searched again, once');
  assert.equal(needsItunesArt({ ...photo, deezerChecked: true, artChecked: true }), true);
  const clean = { id: 'discogs_2', artwork: { source: 'deezer' } };
  assert.equal(needsDeezerArt(clean) || needsItunesArt(clean), false, 'clean art is left alone');
  assert.equal(needsDeezerArt({ ...clean, artwork: { source: 'itunes' } }) || needsItunesArt({ ...clean, artwork: { source: 'itunes' } }), false);
  assert.equal(needsDeezerArt({ id: 'discogs_mock_1', artwork: { source: 'discogs' } }), false, 'demo records are skipped');
}

// A pinned cover is left alone by the background passes
{
  const pinned = { id: 'discogs_5', artworkLocked: true, artwork: { source: 'discogs' } };
  assert.equal(needsDeezerArt(pinned), false);
  assert.equal(needsItunesArt(pinned), false);
}

// ---- syncing must not throw away what the crate has learned since the last sync ------------------------------------
{
  const item = {
    id: 42,
    date_added: '2024-05-01T00:00:00-07:00',
    notes: [],
    basic_information: { title: 'Saga', year: 2023, master_id: 7, artists: [{ name: 'The City of Prague Philharmonic Orchestra' }], genres: ['Stage & Screen'], styles: ['Score'], formats: [{ name: 'Vinyl' }], thumb: 't.jpg', cover_image: 'c.jpg' },
  };
  const existing = {
    id: 'discogs_42', title: 'Old title', year: 2008, masterYear: 2008, masterChecked: true,
    details: { labels: [{ name: 'Silva Screen' }], fetchedAt: '2026-09-01T00:00:00Z' },
    tracklist: [{ title: 'Track', duration: '3:00' }],
    primaryGenre: 'Soundtrack', itunesUrl: 'https://music.apple.com/x', genreChecked: true, artChecked: true, deezerChecked: true, artworkLocked: true,
    artwork: { source: 'deezer', highRes: 'https://cdn/deezer.jpg', thumbnail: 'https://cdn/deezer-small.jpg' },
    context: { backCover: 'https://caa/back.jpg' },
  };
  const merged = buildCollectionRecord(item, existing, []);
  assert.equal(merged.title, 'Saga', 'fresh Discogs fields win');
  assert.equal(merged.pressingYear, 2023);
  for (const kept of ['details', 'primaryGenre', 'itunesUrl', 'genreChecked', 'artChecked', 'deezerChecked', 'artworkLocked', 'masterChecked']) {
    assert.deepEqual(merged[kept], existing[kept], `${kept} survives a sync`);
  }
  assert.equal(merged.artwork.source, 'deezer', 'cleaner artwork found elsewhere survives a sync');
  assert.deepEqual(merged.context, existing.context);
  assert.equal(merged.tracklist.length, 1);

  const fresh = buildCollectionRecord(item, undefined, []);
  assert.equal(fresh.id, 'discogs_42');
  assert.equal(fresh.artwork.source, 'discogs', 'a brand new record starts with the Discogs image');
}

// ---- is a candidate cover the same artwork as the Discogs image? ---------------------------------------------------
import { readFileSync } from 'node:fs';
import { fingerprint, scoreImages, decide, sameArtwork, SIZE } from '../public/js/imagematch.js';

// A synthetic 96 x 96 picture from a function of (x, y) returning [r, g, b]
const picture96 = (fn) => {
  const px = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) { const [r, g, b] = fn(x, y); const i = (y * SIZE + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; }
  return px;
};
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
// a cover: a heart on a coloured ground with a text bar, so it has real structure
const cover = (x, y) => {
  const heart = Math.hypot(x - 48, y - 46) < 22;
  const bar = y > 74 && y < 84 && x > 20 && x < 76;
  if (bar) return [240, 220, 160];
  return heart ? [200, 40, 50] : [40, 60, 130];
};
const checker = (x, y) => (Math.floor(x / 12) % 2 === Math.floor(y / 12) % 2 ? [230, 200, 60] : [30, 110, 40]); // a checkerboard
{
  const original = fingerprint(picture96(cover));
  assert.equal(original.grey.length, SIZE * SIZE);
  assert.ok(Math.abs([...original.hue].reduce((a, b) => a + b, 0) - 1) < 1e-6, 'the hue histogram adds up to 1');

  // The same picture photographed badly: dimmer, a colour cast, a border, a tilt-ish shift, and glare
  const photo = (x, y) => {
    const inner = cover(Math.round((x - 8) * 1.12), Math.round((y - 6) * 1.12)); // smaller, shifted: margins around the sleeve
    const outside = x < 8 || y < 6 || x > 88 || y > 90;
    const glare = Math.max(0, 90 - Math.hypot(x - 70, y - 30) * 3);
    const [r, g, b] = outside ? [90, 84, 78] : inner;
    return [clamp(r * 0.75 + 20 + glare), clamp(g * 0.75 + 12 + glare), clamp(b * 0.7 + 18 + glare)];
  };
  assert.equal(sameArtwork(fingerprint(picture96(photo)), original), true, 'a dim, cast, framed, glared photo of the same cover still matches');
  assert.equal(sameArtwork(fingerprint(picture96(checker)), original), false, 'a different picture does not');
  const ramp = (x) => { const v = Math.round((x / SIZE) * 255); return [v, v, v]; };
  assert.equal(sameArtwork(fingerprint(picture96(ramp)), original), false, 'a plain gradient does not');
  const flat = (x, y) => [200, 200, 200];
  assert.equal(sameArtwork(fingerprint(picture96(flat)), original), false, 'a flat grey picture matches nothing');
  const scores = scoreImages(fingerprint(picture96(cover)), original);
  assert.ok(scores.edge > 0.99 && scores.grey > 0.99, 'identical pictures score as identical');
}

{
  // Real Discogs/Deezer scores, measured in a browser: the thresholds are pinned to what was measured
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/artwork-scores.json', import.meta.url), 'utf8'));
  const scored = ([label, edge, grey, hue]) => ({ label, edge, grey, hue });
  const accepted = fixture.positives.map(scored).filter(decide);
  assert.ok(accepted.length >= 82, `real pressings of the right album are accepted (${accepted.length} of ${fixture.positives.length})`);
  // the borderline true matches that the first version wrongly rejected: a photo of a sleeve with glare and margins
  for (const [label, edge, grey, hue] of [['Star-Crossed photo', 0.486, 0.671, 0.858], ['NVM photo', 0.475, 0.736, 0.75], ['NVM photo 2', 0.497, 0.687, 0.814]]) {
    assert.equal(decide({ edge, grey, hue }), true, `${label} is accepted`);
  }
  // photographs of the disc, or a test-pressing sheet, are not the cover
  assert.equal(decide({ edge: 0.114, grey: 0.254, hue: 0.573 }), false);
  for (const impostor of fixture.impostors.map(scored)) assert.equal(decide(impostor), false, `${impostor.label} is never matched`);
  const worst = Math.max(...fixture.impostors.map((i) => i[1]));
  assert.ok(worst < 0.5, `the closest mismatch (${worst}) stays clear of the edge threshold`);
}

// ---- judging a candidate cover, and the choice a person can make --------------------------------------------------
import { judgeCandidate, needsArtVerification, needsArtRecheck, ART_MATCH_VERSION, deezerThumb, itunesThumb } from '../public/js/sync.js';
import { artControl, artChoiceUpdates } from '../public/js/artwork.js';

{
  const record = { id: 'discogs_1', discogsArtwork: { thumbnail: 'https://i.discogs.com/a', highRes: 'https://i.discogs.com/b', source: 'discogs' }, artwork: { source: 'discogs' } };
  const same = fingerprint(picture96(cover));
  const other = fingerprint(picture96(checker));
  const loader = (map) => async (url) => { if (!(url in map)) throw new Error('no such image'); return map[url]; };
  const seen = [];
  const relay = '/api/img?url=' + encodeURIComponent('https://i.discogs.com/a');

  const judged = await judgeCandidate(record, 'https://cdn/deezer', async (url) => { seen.push(url); return same; });
  assert.equal(judged, 'same');
  assert.ok(seen.includes('/api/img?url=' + encodeURIComponent('https://i.discogs.com/a')), 'the Discogs image is read through our own address');
  assert.equal(await judgeCandidate(record, 'https://cdn/x', loader({ [relay]: same, 'https://cdn/x': other })), 'different');
  assert.equal(await judgeCandidate(record, 'https://cdn/missing', loader({ [relay]: same })), 'unknown', 'an image that will not load decides nothing');
  assert.equal(await judgeCandidate({ id: 'x', artwork: { source: 'discogs' } }, 'https://cdn/x', async () => { throw new Error('unused'); }), 'same', 'no Discogs image, nothing to disagree with');

  assert.equal(deezerThumb('https://cdn/1000x1000-000000-80-0-0.jpg'), 'https://cdn/250x250-000000-80-0-0.jpg');
  assert.equal(itunesThumb('https://is1/thumb/cover.jpg/1200x1200bb.jpg'), 'https://is1/thumb/cover.jpg/250x250bb.jpg');

  // covers swapped in before the comparison existed get checked once
  const swapped = { ...record, artwork: { source: 'deezer', highRes: 'x' } };
  assert.equal(needsArtVerification(swapped), true);
  assert.equal(needsArtVerification({ ...swapped, artVerified: true }), false);
  assert.equal(needsArtVerification({ ...swapped, artworkLocked: true }), false, 'a cover a person chose is never second-guessed');
  assert.equal(needsArtVerification(record), false, 'a Discogs image needs no check');

  // covers turned down by the earlier, stricter comparison are judged once more
  const turnedDown = { ...record, artCandidate: { source: 'deezer', highRes: 'https://cdn/d.jpg' } };
  assert.equal(needsArtRecheck(turnedDown), true);
  assert.equal(needsArtRecheck({ ...turnedDown, artMatchVersion: ART_MATCH_VERSION }), false, 'only once');
  assert.equal(needsArtRecheck({ ...turnedDown, artworkLocked: true }), false, 'a chosen cover is not second-guessed');
  assert.equal(needsArtRecheck(record), false, 'no candidate, nothing to recheck');

  // the control
  const cleaner = { ...record, artwork: { source: 'deezer', highRes: 'https://cdn/d.jpg' } };
  assert.equal(artControl(cleaner).action, 'discogs');
  assert.match(artControl(cleaner).note, /matched to the Discogs image/);
  assert.match(artControl({ ...cleaner, artworkLocked: true }).note, /you chose/, 'a hand-picked cover is not described as auto-matched');
  assert.equal(artControl(record), null, 'nothing to choose between');
  const rejected = { ...record, artCandidate: { source: 'deezer', highRes: 'https://cdn/d.jpg' } };
  assert.equal(artControl(rejected).action, 'candidate');
  assert.match(artControl(rejected).label, /Deezer/);
  assert.equal(artControl({ ...record, artworkLocked: true }).action, 'retry');

  // choosing switches between the two covers and pins the record; nothing is lost
  const toDiscogs = artChoiceUpdates(cleaner, 'discogs');
  assert.equal(toDiscogs.artwork.source, 'discogs');
  assert.equal(toDiscogs.artworkLocked, true);
  assert.equal(toDiscogs.artCandidate.source, 'deezer', 'the cleaner cover is kept so it can be brought back');
  const back = artChoiceUpdates({ ...cleaner, ...toDiscogs }, 'candidate');
  assert.equal(back.artwork.source, 'deezer', 'and the person can change their mind');
  assert.equal(artChoiceUpdates({ id: 'x', artwork: { source: 'deezer' } }, 'discogs'), null, 'no Discogs image to go back to');
  assert.equal(artChoiceUpdates(record, 'retry').artworkLocked, false);
  assert.equal(artChoiceUpdates(record, 'bogus'), null);
}

// ---- Wikipedia infobox fields ------------------------------------------------------------------------------------
{
  // The real "NVM" infobox: the producer field is empty and the next line is another field
  const nvm = [
    '{{Infobox album', '| name       = NVM', '| released   = {{Start date|2014|02|25}}', '| recorded   =', '| studio     =',
    '| genre      = [[Pop punk]]', '| length     = {{Duration|m=27|s=47}}', '| label      = [[Hardly Art]]', '| producer   =',
    '| prev_title = Shame Spiral', '| prev_year  = 2008', '| next_title = [[Lost Time (Tacocat album)|Lost Time]]', '}}',
  ].join('\n');
  assert.equal(infoboxField(nvm, 'producer'), '', 'an empty field stays empty, and does not take the next line');
  assert.equal(infoboxField(nvm, 'recorded'), '', 'the same for a field before another empty one');
  assert.equal(infoboxField(nvm, 'label'), 'Hardly Art', 'links are cleaned');

  const full = ['{{Infobox album', '| label    = [[Sub Pop]]', '| producer = [[Steve Albini]]<ref>cite</ref>', '| recorded = Electrical Audio, Chicago', '}}'].join('\n');
  assert.equal(infoboxField(full, 'producer'), 'Steve Albini');
  assert.equal(infoboxField(full, 'recorded'), 'Electrical Audio, Chicago', 'the last field before the closing braces');

  const list = ['{{Infobox album', '| producer = {{Plainlist|', '* [[Butch Vig]]', '* [[Nirvana]]', '}}', '| label = DGC', '}}'].join('\n');
  assert.equal(infoboxField(list, 'producer'), 'Butch Vig, Nirvana', 'a multi-line list is joined');
  assert.equal(infoboxField(list, 'missing'), '');
  assert.equal(infoboxField('', 'producer'), '');

  // Something already saved on a record that still has the leaked text is never shown
  assert.equal(usefulValue('prev_title = Shame Spiral'), '');
  assert.equal(usefulValue('Steve Albini'), 'Steve Albini');
  assert.equal(usefulValue('Hardly Art'), 'Hardly Art');
}

{
  const ubl = ['{{Infobox album', '| producer = {{Unbulleted list|[[Butch Vig]]|[[Nirvana]]}}', '| label = DGC', '}}'].join('\n');
  assert.equal(infoboxField(ubl, 'producer'), 'Butch Vig, Nirvana', 'a template list is separated by commas, not bars');
}

// ---- the same album under different bracketed titles ---------------------------------------------------------------
{
  assert.equal(searchTitle('TRON: Legacy (Vinyl Edition Motion Picture Soundtrack)'), 'TRON: Legacy');
  assert.equal(searchTitle('Homework [25th Anniversary]'), 'Homework');
  assert.equal(searchTitle('(What\'s the Story) Morning Glory?'), "(What's the Story) Morning Glory?", 'a title that is only brackets is left alone');
  assert.equal(searchTitle('Abbey Road'), 'Abbey Road');

  // iTunes: "(Vinyl Edition ...)" and "(Original ...)" are the same album; a different album is not
  const tron = 'TRON: Legacy (Vinyl Edition Motion Picture Soundtrack)';
  assert.ok(scoreAlbumMatch('Daft Punk', tron, 'Daft Punk', 'TRON: Legacy (Original Motion Picture Soundtrack)') >= 100, 'the digital release of the soundtrack matches');
  assert.equal(scoreAlbumMatch('Daft Punk', tron, 'Daft Punk', 'TRON: Legacy Reconfigured'), -1, 'the remix album does not');
  assert.equal(scoreAlbumMatch('Daft Punk', tron, 'Daft Punk', 'Random Access Memories'), -1);
  assert.equal(scoreAlbumMatch('Daft Punk', tron, 'Nine Inch Nails', 'TRON: Ares (Original Motion Picture Soundtrack)'), -1);
  assert.ok(scoreAlbumMatch('Daft Punk', 'Homework', 'Daft Punk', 'Homework') > scoreAlbumMatch('Daft Punk', 'Homework', 'Daft Punk', 'Homework (25th Anniversary Edition)'), 'the exact title still ranks first');
}

// ---- searching again with the master's title ---------------------------------------------------------------------
{
  const searched = { deezerSearchVersion: ART_SEARCH_VERSION, itunesSearchVersion: ART_SEARCH_VERSION };
  const base = { id: 'discogs_7', masterId: 291615, artwork: { source: 'discogs' }, ...searched };
  assert.equal(needsMasterTitleArt(base), true, 'both searches missed and there is a master');
  assert.equal(needsMasterTitleArt({ ...base, masterId: null }), false, 'a custom entry has no master to ask');
  assert.equal(needsMasterTitleArt({ ...base, deezerSearchVersion: undefined }), false, 'not before the first two searches are done');
  assert.equal(needsMasterTitleArt({ ...base, artCandidate: { source: 'deezer' } }), false, 'a cover is already on offer');
  assert.equal(needsMasterTitleArt({ ...base, masterTitleSearchVersion: ART_SEARCH_VERSION }), false, 'only once');
  assert.equal(needsMasterTitleArt({ ...base, artwork: { source: 'deezer' } }), false, 'clean art is left alone');
  assert.equal(needsMasterTitleArt({ ...base, artworkLocked: true }), false);

  assert.equal(titlesDiffer('Saga', 'Music From The Twilight Saga'), true);
  assert.equal(titlesDiffer('TRON: Legacy (Vinyl Edition Motion Picture Soundtrack)', 'TRON: Legacy (Original Motion Picture Soundtrack)'), false, 'a different bracketed subtitle is already handled by the earlier searches');
  assert.equal(titlesDiffer('Abbey Road', 'abbey road'), false);
  assert.equal(titlesDiffer('Abbey Road', ''), false, 'no master title, nothing to try');
}

// ---- custom releases ---------------------------------------------------------------------------------------------
{
  // the wedding record's release, as Discogs describes it: a draft, no master, no label
  const draft = parseReleaseDetails({ status: 'Draft', country: 'US', labels: [{ name: 'None', catno: '' }], formats: [{ name: 'Lathe Cut', qty: '1', descriptions: ['LP', 'Unofficial Release'] }] });
  assert.equal(draft.status, 'Draft', 'the release status is kept');
  assert.equal(parseReleaseDetails({ status: 'Accepted' }).status, 'Accepted');
  assert.equal(parseReleaseDetails({}).status, '');

  const wedding = { id: 'discogs_32124024', discogsId: 32124024, masterId: null, details: draft, artwork: { source: 'discogs' } };
  assert.equal(isCustomRelease(wedding), true);
  assert.equal(isCustomRelease({ ...wedding, details: { status: 'Accepted' } }), false, 'an accepted release is in the shared database');
  assert.equal(isCustomRelease({ ...wedding, masterId: 291615 }), false, 'a release with a master is known to other services');
  assert.equal(isCustomRelease({ ...wedding, details: undefined }), false, 'not known to be custom until its details arrive');
  assert.equal(isCustomRelease({ ...wedding, details: { status: '' } }), false, 'details saved without a status say nothing');

  // no cover searches for it, at any stage
  const searched = { deezerSearchVersion: ART_SEARCH_VERSION, itunesSearchVersion: ART_SEARCH_VERSION };
  assert.equal(needsDeezerArt(wedding), false);
  assert.equal(needsItunesArt(wedding), false);
  assert.equal(needsMasterTitleArt({ ...wedding, ...searched, masterId: null }), false);
  assert.equal(needsDeezerArt({ ...wedding, details: undefined }), true, 'before its details are known it is treated like any other record');

  // details saved before the status was kept are fetched again, but only for records that could be custom (no master)
  assert.equal(needsDetails({ id: 'discogs_1', discogsId: 1, masterId: null, details: { labels: [] } }), true);
  assert.equal(needsDetails({ id: 'discogs_1', discogsId: 1, masterId: 5, details: { labels: [] } }), false, 'a record with a master cannot be custom');
  assert.equal(needsDetails({ id: 'discogs_1', discogsId: 1, masterId: null, details: { status: 'Draft' } }), false);
  assert.equal(needsDetails({ id: 'discogs_1', discogsId: 1 }), true, 'no details at all');
  assert.equal(needsDetails({ id: 'discogs_mock_1', discogsId: 1 }), false, 'demo records have none to fetch');
}

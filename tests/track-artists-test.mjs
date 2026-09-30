// Who is on each track: compilations, splits and tributes. The fixture is the real Discogs data for a wedding-record compilation
// (release 32124024), where every track has its own artist.
import assert from 'node:assert/strict';
import { artistCredit, mapTrackArtists, trackCredit, trackNames, lyricsArtist, artistsOnRecord, showTrackArtists } from '../public/js/track-artists.js';
import { parseReleaseDetails, mapDiscogsTracklist, needsDetails, refreshedDetails, DETAILS_VERSION } from '../public/js/sync.js';
import { matchRecord, searchWords } from '../public/js/search.js';
import { computeCollectionFacts } from '../public/js/stats-facts.js';

const a = (name, extra = {}) => ({ name, id: 1, anv: '', join: '', role: '', ...extra });
const track = (position, title, artists, extra = {}) => ({ position, type_: 'track', title, duration: '3:00', ...(artists ? { artists } : {}), ...extra });

const discogs = {
  artists: [{ name: 'Various', id: 194, anv: '', join: '' }],
  tracklist: [
    track('A1', 'Collide (Acoustic)', [a('Howie Day', { id: 603121 })]),
    track('A2', 'State of Grace (Acoustic)', [a('Taylor Swift', { id: 1124645 })]),
    track('A3', 'All That', [a('Carly Rae Jepsen', { id: 2710776 })]),
    track('B1', 'Paper Rings', [a('Taylor Swift', { id: 1124645 })]),
    track('B2', 'September', [a('Earth, Wind & Fire', { id: 22164 })]),
    track('B3', "Everybody (Backstreet's Back)", [a('Backstreet Boys', { id: 11002 })]),
    track('B4', 'Jack Sparrow', [a('The Lonely Island', { id: 1362133, join: ',' }), a('Michael Bolton', { id: 274209 })]),
    track('B5', 'Never Gonna Give You Up', [a('Rick Astley', { id: 72872 })]),
  ],
};

// ---- the credit line: joins are kept --------------------------------------------------------------------------------
assert.equal(artistCredit([a('The Lonely Island', { join: ',' }), a('Michael Bolton')]), 'The Lonely Island, Michael Bolton');
assert.equal(artistCredit([a('Hall', { join: '&' }), a('Oates')]), 'Hall & Oates');
assert.equal(artistCredit([a('Artist', { join: 'feat.' }), a('Guest')]), 'Artist feat. Guest');
assert.equal(artistCredit([a('One'), a('Two')]), 'One, Two', 'no join given: a comma');
assert.equal(artistCredit([a('Nirvana (2)')]), 'Nirvana', 'the number Discogs adds to tell two Nirvanas apart is not part of the name');
assert.equal(artistCredit([a('Prince', { anv: 'The Artist' })]), 'The Artist', 'the name as printed on the sleeve, when there is one');
assert.equal(artistCredit([]), '');
assert.equal(artistCredit(undefined), '');

// ---- reading a tracklist ---------------------------------------------------------------------------------------------
{
  const mapped = mapTrackArtists(discogs.tracklist);
  assert.deepEqual(Object.keys(mapped), ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B4', 'B5']);
  assert.deepEqual(mapped.B4, { names: ['The Lonely Island', 'Michael Bolton'], credit: 'The Lonely Island, Michael Bolton' });
  assert.deepEqual(mapped.A1, { names: ['Howie Day'], credit: 'Howie Day' });

  // an ordinary album names no track artists at all, and stays exactly as it was
  assert.deepEqual(mapTrackArtists([track('A1', 'One'), track('A2', 'Two')]), {});
  assert.deepEqual(mapTrackArtists(undefined), {});

  // headings aren't tracks, and a track with no position is numbered the way mapDiscogsTracklist numbers it
  const odd = [{ type_: 'heading', title: 'Disc 1' }, track('', 'One', [a('X')]), track('', 'Two', [a('Y')]), { type_: 'index', title: 'Medley' }, track('', 'Three')];
  assert.deepEqual(Object.keys(mapTrackArtists(odd)), ['1', '2']);
  assert.deepEqual(mapDiscogsTracklist(odd).map((t) => t.position), ['1', '2', '3'], 'the two number tracks the same way');
}

// ---- whole releases: parsed details carry the version and the artists ---------------------------------------------------------
const parsed = parseReleaseDetails({ ...discogs, labels: [], formats: [], extraartists: [] });
assert.equal(parsed.version, DETAILS_VERSION);
assert.equal(DETAILS_VERSION, 2);
assert.deepEqual(parsed.artists, [{ id: 194, name: 'Various' }]);
assert.equal(Object.keys(parsed.trackArtists).length, 8);
assert.deepEqual(parseReleaseDetails({ tracklist: [track('A1', 'Plain')] }).trackArtists, {}, 'nothing named, nothing kept');

const wedding = { id: 'discogs_32124024', discogsId: 32124024, title: "Ryan & Maura's Wedding Record", artist: 'Various', masterId: null, tracklist: mapDiscogsTracklist(discogs.tracklist), details: parsed };
const plain = (extra = {}) => ({ id: 'discogs_1', discogsId: 1, title: 'Plain Album', artist: 'Solo Artist', tracklist: [{ position: 'A1', title: 'One', duration: '3:00' }, { position: 'A2', title: 'Two', duration: '3:00' }], details: parseReleaseDetails({ artists: [{ id: 5, name: 'Solo Artist' }], tracklist: [track('A1', 'One'), track('A2', 'Two')] }), ...extra });

// ---- counting the artists on a record --------------------------------------------------------------------------------------
assert.equal(artistsOnRecord(wedding).length, 8, 'Taylor Swift is on two tracks but is one artist, and "Various" is nobody');
assert.ok(artistsOnRecord(wedding).includes('Michael Bolton') && artistsOnRecord(wedding).includes('The Lonely Island'), 'both artists of a joined credit count');
assert.ok(!artistsOnRecord(wedding).includes('Various'));
assert.deepEqual(artistsOnRecord(plain()), ['Solo Artist']);
assert.deepEqual(artistsOnRecord({ artist: 'Solo Artist' }), ['Solo Artist'], 'without details, the record\'s own artist');
assert.deepEqual(artistsOnRecord({ artist: 'Various', details: { artists: [{ name: 'Various' }] } }), [], 'a compilation we have no track artists for yet has none to count');

// ---- when to print an artist under each track ---------------------------------------------------------------------------------
assert.equal(showTrackArtists(wedding), true, 'a compilation');
assert.equal(showTrackArtists(plain()), false, 'an ordinary album');
assert.equal(showTrackArtists({}), false);
{
  const withTracks = (artist, billed, tracks) => ({ artist, details: { artists: billed.map((name) => ({ name })), trackArtists: mapTrackArtists(tracks) } });
  // Discogs sometimes spells out the album's own artist on every track: nothing to add
  assert.equal(showTrackArtists(withTracks('Solo', ['Solo'], [track('A1', 'x', [a('Solo')]), track('A2', 'y', [a('Solo')])])), false);
  // a collaboration billed to two people, with both on every track
  assert.equal(showTrackArtists(withTracks('A', ['A', 'B'], [track('A1', 'x', [a('A', { join: '&' }), a('B')]), track('A2', 'y', [a('A', { join: '&' }), a('B')])])), false);
  // a split: each side is someone else's
  assert.equal(showTrackArtists(withTracks('A', ['A', 'B'], [track('A1', 'x', [a('A')]), track('B1', 'y', [a('B')])])), true);
  // a guest on one track
  assert.equal(showTrackArtists(withTracks('A', ['A'], [track('A1', 'x', [a('A', { join: 'feat.' }), a('Guest')])])), true);
}

// ---- lyrics are looked up by the artist who sang the song --------------------------------------------------------------------
const b4 = wedding.tracklist.find((t) => t.position === 'B4');
assert.equal(trackCredit(wedding, b4), 'The Lonely Island, Michael Bolton');
assert.deepEqual(trackNames(wedding, b4), ['The Lonely Island', 'Michael Bolton']);
assert.equal(lyricsArtist(wedding, b4), 'The Lonely Island', 'the first of a joined credit');
assert.equal(lyricsArtist(wedding, wedding.tracklist[0]), 'Howie Day', 'not "Various", which finds no lyrics');
assert.equal(lyricsArtist(plain(), plain().tracklist[0]), 'Solo Artist', 'an ordinary album uses its artist');
assert.equal(trackCredit(plain(), plain().tracklist[0]), '');
assert.equal(lyricsArtist({ artist: 'X' }, undefined), 'X');

// ---- search finds a record by the artist of one of its tracks ---------------------------------------------------------------------
assert.deepEqual(matchRecord(wedding, searchWords('taylor swift')), { track: 'State of Grace (Acoustic)', index: 1 }, 'the first of her two tracks');
assert.deepEqual(matchRecord(wedding, searchWords('howie day collide')), { track: 'Collide (Acoustic)', index: 0 });
assert.deepEqual(matchRecord(wedding, searchWords('earth wind september')), { track: 'September', index: 4 });
assert.deepEqual(matchRecord(wedding, searchWords('lonely island')), { track: 'Jack Sparrow', index: 6 });
assert.deepEqual(matchRecord(wedding, searchWords('wedding')), { track: null }, 'the album itself still matches first');
assert.equal(matchRecord(wedding, searchWords('taylor swift september')), null, 'one track has to match every word: she did not sing September');
assert.equal(matchRecord(wedding, searchWords('beyonce')), null);
assert.deepEqual(matchRecord(plain(), searchWords('solo artist two')), { track: 'Two', index: 1 }, 'ordinary search is unchanged');

// ---- the one-time refresh ------------------------------------------------------------------------------------------------------------
{
  const saved = (details) => ({ id: 'discogs_9', discogsId: 9, masterId: 99, details });
  assert.equal(needsDetails(saved({ status: 'Accepted', credits: [] })), true, 'details saved before versions are fetched again');
  assert.equal(needsDetails(saved({ status: 'Accepted', version: 1 })), true);
  assert.equal(needsDetails(saved({ status: 'Accepted', version: DETAILS_VERSION })), false, 'and only once');
  assert.equal(needsDetails({ id: 'discogs_9', discogsId: 9 }), true, 'no details at all');
  assert.equal(needsDetails({ id: 'discogs_mock_001', discogsId: 101 }), false, 'the demo records are never fetched');
  assert.equal(needsDetails({ id: 'custom_1' }), false, 'nothing to fetch for a record with no Discogs id');

  // a refresh never loses credits that an earlier look at the master release had found
  const old = { credits: [{ name: 'Someone', role: 'Producer' }], creditsFallbackChecked: true };
  assert.deepEqual(refreshedDetails(old, { version: 2, credits: [], creditsFallbackChecked: false }).credits, old.credits, 'kept when the fresh ones are empty');
  assert.equal(refreshedDetails(old, { version: 2, credits: [], creditsFallbackChecked: false }).creditsFallbackChecked, true);
  assert.deepEqual(refreshedDetails(old, { version: 2, credits: [{ name: 'New', role: 'Bass' }] }).credits, [{ name: 'New', role: 'Bass' }], 'fresh credits win when there are some');
  assert.equal(refreshedDetails(old, { version: 2, credits: [] }).version, 2, 'everything else is the fresh details');
  assert.deepEqual(refreshedDetails(undefined, { version: 2, credits: [] }), { version: 2, credits: [] }, 'nothing to keep');
}

// ---- the fact: most artists on one record ------------------------------------------------------------------------------------------------
{
  const f = computeCollectionFacts([wedding]).find((x) => x.id === 'most-artists');
  assert.equal(f.record.title, "Ryan & Maura's Wedding Record");
  assert.equal(f.detail, '8 artists');
  assert.equal(f.kicker, 'Most artists on one record');
  assert.equal(computeCollectionFacts([plain()]).find((x) => x.id === 'most-artists'), undefined, 'one artist is not a fact');

  const split = { ...plain(), details: parseReleaseDetails({ artists: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }], tracklist: [track('A1', 'x', [a('A')]), track('B1', 'y', [a('B')])] }) };
  assert.equal(computeCollectionFacts([split]).find((x) => x.id === 'most-artists'), undefined, 'two artists on a split is not enough');

  const bigger = { ...wedding, id: 'discogs_2', title: 'Another Compilation', details: parseReleaseDetails({ artists: [{ id: 194, name: 'Various' }], tracklist: [...discogs.tracklist, track('B6', 'Bonus', [a('Extra Artist', { id: 999 })])] }) };
  const two = computeCollectionFacts([wedding, bigger]).find((x) => x.id === 'most-artists');
  assert.equal(two.record.title, 'Another Compilation', 'the wider one wins');
  assert.equal(two.detail, '9 artists');
}

console.log('Track artist tests passed.');

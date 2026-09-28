// Unit tests for the pure logic that decides what the album page shows: credits, album matching, placeholders.
import assert from 'node:assert/strict';
import {
  splitCreditRoles, creditKinds, groupCredits, parseCollectionFields, mapDiscogsTracklist, parseReleaseDetails,
  normalizeItunesGenre, getGenreTags, getRecordTags, tagLabel, calculateTotalDuration,
  cleanTrackAudioTags, stripFeaturing, normalizeTrackTitle,
} from '../public/js/sync.js';
import { pickAlbumPage, isVariousArtists, pickBackCoverReleases, pickReleaseGroup, infoboxField } from '../public/js/wiki.js';
import { usefulValue, isCustomRelease } from '../public/js/values.js';
import { pickDeezerAlbum, pickDeezerCover, searchTitle, normalize as deezerNormalize } from '../functions/_lib/deezer.js';
import { cleanArtistName, cleanTrackTitle, parseDurationToSeconds, formatLyricsHTML } from '../public/js/lyrics.js';

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

const withTrackCredits = parseReleaseDetails({
  extraartists: [{ id: 1, name: 'Ann', role: 'Vocals' }],
  tracklist: [
    { title: 'Track 1', extraartists: [{ id: 2, name: 'Bob', role: 'Bass' }, { id: 1, name: 'Ann', role: 'Vocals' }] },
    { title: 'Track 2', extraartists: [{ id: 3, name: 'Charlie', role: 'Drums' }] },
  ],
});
assert.deepEqual(withTrackCredits.credits.map((c) => c.name), ['Ann', 'Bob', 'Charlie'], 'includes and dedupes track extraartists');


// ---- genres and tags ------------------------------------------------------------------------------------------
assert.equal(normalizeItunesGenre('Pop'), 'Pop');
assert.equal(normalizeItunesGenre('Totally Made Up'), null);
assert.equal(normalizeItunesGenre(''), null);
assert.deepEqual(getGenreTags({ primaryGenre: 'Pop', genres: ['Electronic', 'pop'] }), ['Pop', 'Electronic'], 'primary genre first, no duplicates');
assert.deepEqual(getRecordTags({ genres: ['Rock'], styles: ['Goth Rock', 'Rock'] }), ['Rock', 'Goth Rock']);
assert.equal(tagLabel('Funk / Soul'), 'Soul & Funk');
assert.equal(tagLabel('Stage & Screen'), 'Soundtrack');
assert.equal(tagLabel('Jazz'), 'Jazz');

// ---- durations ------------------------------------------------------------------------------------------------
assert.equal(calculateTotalDuration([]), null);
assert.equal(calculateTotalDuration([{ duration: '3:00' }, { duration: '2:00' }]), '5 min');


// ---- grid and list views: jump rail, pressing tags, art sizes -------------------------------------------
import { railLabel, groupRail, cardTags, smallArtUrl, normalizeView, VIEWS } from '../public/js/browse.js';

{
  assert.deepEqual(VIEWS, ['stack', 'grid', 'list']);
  assert.equal(normalizeView('grid'), 'grid');
  assert.equal(normalizeView('carousel'), 'stack', 'an unknown or missing view falls back to the stack');
  assert.equal(normalizeView(null), 'stack');

  // Letters follow the sort: "The Beatles" files under B for the artist sort, T for the first-name sort
  const beatles = { artist: 'The Beatles', year: 1969 };
  assert.equal(railLabel('artist-last-year', beatles), 'B');
  assert.equal(railLabel('artist', beatles), 'B');
  assert.equal(railLabel('artist-first', beatles), 'T');
  assert.equal(railLabel('artist-last-year', { artist: '2Pac' }), '#', 'digits and symbols share one entry');
  assert.equal(railLabel('artist-last-year', { artist: '  ' }), '#', 'an empty name does not crash');
  assert.equal(railLabel('artist-last-year', { artist: 'Ólafur Arnalds' }), '#', 'non A-Z letters go under #');
  assert.equal(railLabel('year', { masterYear: 1999 }), '1990s', 'years become decades');
  assert.equal(railLabel('year', { year: 2025 }), '2020s');
  assert.equal(railLabel('year', {}), '–', 'no year yet');
  assert.equal(railLabel('genre', beatles), null, 'genre and recently-added sorts have no rail');
  assert.equal(railLabel('added', beatles), null);

  // A rail entry is where each run starts, in the order shown
  const list = ['Aphex Twin', 'AFI', 'Bowie', 'Bush', 'Clash', 'The Clash', 'Zappa'].map((artist) => ({ artist }));
  const groups = groupRail(list, (r) => railLabel('artist-first', r));
  assert.deepEqual(groups, [{ label: 'A', index: 0 }, { label: 'B', index: 2 }, { label: 'C', index: 4 }, { label: 'T', index: 5 }, { label: 'Z', index: 6 }]);
  assert.deepEqual(groupRail(list, () => null), [], 'no labels, no rail');
  assert.deepEqual(groupRail(list, null), []);
  assert.deepEqual(groupRail([], (r) => r.artist), []);
}

{
  const rec = (formats) => ({ details: { formats } });
  assert.deepEqual(cardTags({}), [], 'no details yet, no tags');
  assert.deepEqual(cardTags(rec([])), []);
  assert.deepEqual(cardTags(rec([{ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Album'], text: '' }])), [], 'a plain black LP earns none');
  assert.deepEqual(
    cardTags(rec([{ name: 'Vinyl', qty: '2', descriptions: ['LP', 'Album', 'Limited Edition', 'Reissue', 'Remastered'], text: 'Red Marbled' }])),
    ['2 × LP', 'Red Marbled', 'Limited'],
    'double LP, colour, then the most telling words; never more than three',
  );
  assert.deepEqual(cardTags(rec([{ name: 'Vinyl', qty: '1', descriptions: ['7"', 'Single', '45 RPM'], text: '' }])), ['7"', 'Single']);
  assert.deepEqual(cardTags(rec([{ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Album', '180 Gram'], text: 'Black' }])), ['180g']);
  assert.deepEqual(cardTags(rec([{ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Picture Disc'], text: '' }])), ['Picture disc'], 'a picture disc says so once');
  assert.deepEqual(
    cardTags(rec([{ name: 'Vinyl', qty: '1', descriptions: ['LP'], text: 'Blue [Light Blue]' }])),
    ['Blue'],
    'a bracketed shade is dropped from the label',
  );

  // Big sleeves are for the stack; tiles and rows ask the source for less
  const itunes = { artwork: { highRes: 'https://is1.mzstatic.com/x/1200x1200bb.jpg' } };
  assert.equal(smallArtUrl(itunes, 300), 'https://is1.mzstatic.com/x/300x300bb.jpg');
  const deezer = { artwork: { highRes: 'https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg' } };
  assert.ok(smallArtUrl(deezer, 250).includes('/250x250-'), 'Deezer sizes are switched too');
  const discogs = { artwork: { highRes: 'https://i.discogs.com/abc/rs:fit/w:600/x.jpeg' } };
  assert.equal(smallArtUrl(discogs, 300), discogs.artwork.highRes, 'other sources are left as they are');
  assert.equal(smallArtUrl({}, 300), '', 'no art, no address');
}


// ---- the summary line: discs from two up, speed only when unusual ------------------------------------------
import { discCount, unusualSpeed, trackSummary, pressingNotes } from '../public/js/vinyl.js';

{
  const lp = (extra = {}) => ({ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Album'], text: '', ...extra });
  assert.equal(trackSummary({ trackCount: 8, sideKeys: ['A', 'B'], formats: [lp()] }), '8 tracks', 'a single LP: no sides, no discs');
  assert.equal(trackSummary({ trackCount: 1, sideKeys: ['A'], formats: [lp()] }), '1 track');
  assert.equal(trackSummary({ trackCount: 17, sideKeys: ['A', 'B', 'C', 'D'], formats: [lp({ qty: '2' })] }), '17 tracks · 2 discs');
  assert.equal(trackSummary({ trackCount: 12, sideKeys: ['A', 'B'], formats: [lp({ descriptions: ['LP', '45 RPM'] })] }), '12 tracks · 45 rpm');
  assert.equal(trackSummary({ trackCount: 24, sideKeys: [], formats: [lp({ qty: '3', descriptions: ['LP', '33 ⅓ RPM'] })] }), '24 tracks · 3 discs', '33 ⅓ is never mentioned');
  assert.equal(trackSummary({ trackCount: 4, formats: [{ name: 'Vinyl', qty: '1', descriptions: ['7"', '45 RPM'] }] }), '4 tracks · 45 rpm');
  assert.equal(trackSummary({ trackCount: 2, formats: [{ name: 'Vinyl', qty: '1', descriptions: ['7"', '78 RPM'] }] }), '2 tracks · 78 rpm');
  assert.equal(trackSummary({ trackCount: 0 }), '', 'nothing known, nothing shown');
  assert.equal(trackSummary({ trackCount: 0, formats: [lp({ descriptions: ['12"', '45 RPM'] })] }), '45 rpm', 'the speed shows even before the tracks are known');

  // Without details, the discs come from the track positions
  assert.equal(discCount(undefined, ['A', 'B']), 1);
  assert.equal(discCount(undefined, ['A', 'B', 'C', 'D']), 2);
  assert.equal(discCount(undefined, ['A', 'B', 'C']), 2, 'an odd count rounds up');
  assert.equal(discCount(undefined, ['Disc 1', 'Disc 2', 'Disc 3']), 3);
  assert.equal(discCount(undefined, ['Other']), 0, 'unlabelled tracks say nothing');
  assert.equal(discCount([lp({ qty: '2' }), { name: 'CD', qty: '1' }], []), 2, 'only the vinyl counts on a mixed release');
  assert.equal(discCount([lp({ qty: '2' }), lp({ qty: '1' })], []), 3, 'separate vinyl entries add up');
  assert.equal(unusualSpeed([lp({ descriptions: ['LP', '33 RPM'] })]), '');
  assert.equal(unusualSpeed([lp({ text: '45rpm' })]), '45 rpm', 'a note typed without a space is understood');
  assert.equal(unusualSpeed(undefined), '');
  // The wording Discogs really uses for a 7" single
  assert.equal(unusualSpeed([{ name: 'Vinyl', qty: '1', descriptions: ['7"', '45 RPM', 'Single', 'Stereo'] }]), '45 rpm');
  assert.equal(unusualSpeed([{ name: 'Vinyl', qty: '1', descriptions: ['12"', '33 ⅓ RPM', 'Single'] }]), '');
  assert.deepEqual(pressingNotes({ sideKeys: ['A', 'B', 'C', 'D'], formats: [{ name: 'Vinyl', qty: '2', descriptions: ['LP', '45 RPM'] }] }), ['2 discs', '45 rpm']);
  assert.deepEqual(pressingNotes({ sideKeys: ['A', 'B'], formats: [] }), [], 'an ordinary record has nothing to add');
  assert.equal(unusualSpeed([{ name: 'CD', descriptions: ['45 RPM'] }]), '', 'only vinyl has a speed');
}


// ---- the stats page: a sentence, an index, spines, and honest money --------------------------------------------
import { statsHTML, valueHTML, spinesHTML, playTime } from '../public/js/statsview.js';

{
  assert.equal(playTime(50 * 60), '50 min');
  assert.equal(playTime(3600), '1 hr');
  assert.equal(playTime(5220), '1 hr 27 min');

  const rec = (id, artist, year, extra = {}) => ({ id, artist, title: `Title ${id}`, year, genres: ['Rock'], dateAdded: '2021-03-05T00:00:00Z', tracklist: [{ duration: '40:00' }], artwork: { highRes: 'https://x/600x600bb.jpg' }, ...extra });
  const html = statsHTML(computeStats([rec('a', 'AFI', 1999), rec('b', 'AFI', 2003), rec('c', 'Miles Davis', 1959)]));
  assert.ok(html.includes('<b>3</b> records by <b>2</b> artists'), 'the numbers sit in a sentence');
  assert.ok(html.includes('released between <b>1959</b> and <b>2003</b>'));
  const stats3 = computeStats([rec('a', 'AFI', 1999), rec('b', 'AFI', 2003), rec('c', 'Miles Davis', 1959)]);
  const topArtistFact = stats3.standoutsPool.find((item) => item.id === 'top-artist');
  assert.ok(topArtistFact && topArtistFact.count === 2, 'the artist you own most of is one of the facts to choose from');
  // The panel shows four facts drawn at random from the pool, so any one of them may or may not appear
  const shown = (statsHTML(stats3).match(/<li class="st-standout/g) || []).length;
  assert.equal(shown, Math.min(4, stats3.standoutsPool.length), 'four facts are shown (or all of them, if there are fewer)');
  assert.ok(html.includes('st-dots'), 'genres are an index with leaders');
  assert.ok(!html.includes('stat-bar'), 'the old bar charts are gone');
  assert.equal(statsHTML(computeStats([])), '<p class="st-note">Nothing in the crate yet.</p>');
  assert.ok(!statsHTML(computeStats([rec('a', 'X', 2000)])).includes('released between'), 'one year needs no range');
  assert.ok(!statsHTML(computeStats([rec('a', '<b>x</b>', 2000)])).includes('<b>x</b>'), 'names are escaped');

  // A big collection: a spine can stand for several records, and the row says so
  const many = [{ name: '2010s', decade: 2010, count: 90, years: Array.from({ length: 90 }, (_, i) => 2010 + (i % 10)) }];
  const shelf = spinesHTML(many);
  assert.equal((shelf.match(/<i /g) || []).length, 30, '90 records at 3 to a spine');
  assert.ok(shelf.includes('up to 3 records'));
  assert.equal((spinesHTML([{ name: '1990s', decade: 1990, count: 4, years: [1990, 1991, 1992, 1993] }]).match(/<i /g) || []).length, 4, 'a small shelf has one spine each');

  // The value: whole dollars, and where the median falls between low and high
  const v = valueHTML({ minimum: '$924.70', median: '$1,552.55', maximum: '$3,186.48' });
  assert.ok(v.includes('Worth about <b>$1,552</b>, somewhere between $924 and $3,186.'));
  assert.ok(v.includes('left:27.8%'), 'the median marker sits 27.8% of the way along');
  assert.ok(!valueHTML({ minimum: '$5', median: '$5', maximum: '$5' }).includes('st-range'), 'no range to show when low and high match');
  assert.ok(valueHTML('loading').includes('Asking Discogs'));
  assert.ok(valueHTML('error').includes("Couldn't reach Discogs"));
}


// ---- filters and empty states ------------------------------------------------------------------------------------
import { facetsFor, matchesFilters, activeCount, toggleOption, describeSelection, emptySelection } from '../public/js/filters.js';
import { emptyState } from '../public/js/emptystate.js';

{
  const lp = (extra = {}) => ({ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Album'], text: '', ...extra });
  const records = [
    { id: 'a', year: 1999, masterYear: 1999, details: { formats: [lp()] } },
    { id: 'b', year: 2003, details: { formats: [lp({ qty: '2', text: 'Red Marbled' })] } },
    { id: 'c', year: 1985, details: { formats: [{ name: 'Vinyl', qty: '1', descriptions: ['7"', '45 RPM', 'Single'] }] } },
    { id: 'd', year: 1994 },
  ];
  const facets = facetsFor(records);
  assert.deepEqual(facets.decades.map((f) => [f.key, f.count]), [['1980s', 1], ['1990s', 2], ['2000s', 1]], 'decades run oldest first and include records without details');
  assert.deepEqual(facets.sizes.map((f) => [f.key, f.count]), [['12"', 2], ['7"', 1]], 'an LP counts as a twelve-inch');
  assert.deepEqual(facets.pressings.map((f) => f.key).sort(), ['Black', 'Marbled']);
  assert.deepEqual(facets.discs.map((f) => f.label), ['One disc', 'Two or more discs']);
  assert.deepEqual(facets.speeds.map((f) => f.key), ['45 rpm'], 'the usual speed is not an option');
  assert.equal(facets.detailed, 3);
  assert.equal(facets.total, 4);

  const pick = (group, ...keys) => ({ ...emptySelection(), [group]: keys });
  const ids = (sel) => records.filter((r) => matchesFilters(r, sel)).map((r) => r.id);
  assert.deepEqual(ids(emptySelection()), ['a', 'b', 'c', 'd'], 'nothing chosen shows everything');
  assert.deepEqual(ids(pick('decades', '1990s')), ['a', 'd']);
  assert.deepEqual(ids(pick('decades', '1980s', '2000s')), ['b', 'c'], 'options in one group are alternatives');
  assert.deepEqual(ids({ ...pick('decades', '1990s', '2000s'), pressings: ['Marbled'] }), ['b'], 'groups narrow each other');
  assert.deepEqual(ids(pick('discs', 'multi')), ['b']);
  assert.deepEqual(ids(pick('speeds', '45 rpm')), ['c']);
  assert.deepEqual(ids(pick('sizes', '12"')), ['a', 'b'], 'a record with no details yet cannot match a detail filter');

  assert.equal(activeCount({ ...pick('decades', '1990s', '2000s'), sizes: ['7"'] }), 3);
  const once = toggleOption(emptySelection(), 'decades', '1990s');
  assert.deepEqual(once.decades, ['1990s']);
  assert.deepEqual(toggleOption(once, 'decades', '1990s').decades, [], 'choosing it again takes it off');
  assert.deepEqual(emptySelection().decades, [], 'toggling never changes the original');
  assert.equal(describeSelection({ ...pick('decades', '1990s'), discs: ['multi'] }), '1990s, Two or more discs');
}

{
  assert.equal(emptyState({ total: 5, shown: 3 }), null, 'something to show: nothing to say');
  assert.equal(emptyState({ total: 0, shown: 0, syncing: true }).title, 'Bringing in your crate');
  const none = emptyState({ total: 0, shown: 0, connected: false });
  assert.equal(none.actions[0].id, 'connect');
  assert.equal(emptyState({ total: 0, shown: 0, connected: false, configured: false }).actions[0].id, 'connect', 'still a way forward without sign-in set up');
  assert.equal(emptyState({ total: 0, shown: 0, connected: true }).actions[0].id, 'check');
  const search = emptyState({ total: 50, shown: 0, query: ' kate ' });
  assert.equal(search.title, 'Nothing matches “kate”');
  assert.equal(search.actions[0].id, 'clear-search');
  assert.equal(emptyState({ total: 50, shown: 0, genre: 'Jazz' }).actions[0].id, 'reset');
  const both = emptyState({ total: 50, shown: 0, query: 'x', genre: 'Jazz', filters: '1990s' });
  assert.equal(both.title, 'Nothing matches “x” + Jazz + 1990s');
  assert.equal(both.actions[0].label, 'Clear search and filters');
}


// ---- welcome and first sync --------------------------------------------------------------------------------------
import { progressLabel, progressFraction, recentCovers } from '../public/js/welcome.js';

{
  assert.equal(progressLabel({ count: 23, total: 51 }), '23 of 51 records');
  assert.equal(progressLabel({ count: 1, total: 1 }), '1 of 1 record');
  assert.equal(progressLabel({ count: 1200, total: 3400 }), '1,200 of 3,400 records');
  assert.equal(progressLabel({ count: 100, page: 1, totalPages: 4 }), 'Page 1 of 4', 'no total yet: pages');
  assert.equal(progressLabel({ count: 12 }), '12 records so far');
  assert.equal(progressLabel({}), 'Getting started');
  assert.equal(progressFraction({ count: 25, total: 50 }), 0.5);
  assert.equal(progressFraction({ count: 80, total: 50 }), 1, 'never past the end');
  assert.equal(progressFraction({ page: 1, totalPages: 4 }), 0.25);
  assert.ok(progressFraction({}) > 0, 'a little movement while nothing is known');

  const rec = (id, thumb) => ({ id, artwork: thumb ? { thumbnail: thumb } : {} });
  const first = recentCovers([rec('a', 'u1'), rec('b', ''), rec('c', 'u3')]);
  assert.deepEqual(first.map((c) => c.id), ['a', 'c'], 'records with no picture are skipped');
  const next = recentCovers([rec('c', 'u3'), rec('d', 'u4')], first);
  assert.deepEqual(next.map((c) => c.id), ['a', 'c', 'd'], 'no repeats across pages');
  const many = recentCovers(Array.from({ length: 30 }, (_, i) => rec(`r${i}`, `u${i}`)), [], 14);
  assert.equal(many.length, 14);
  assert.equal(many[13].id, 'r29', 'the latest are kept');
}


// ---- the wall (screensaver) ----------------------------------------------------------------------------------------
import { wallSupported, planWall, wallPattern, headingAt, recycled, spotSize, pickSpot } from '../public/js/wall.js';

{
  assert.equal(wallSupported(1366, 1024), true, 'an iPad');
  assert.equal(wallSupported(744, 1133), true, 'a small tablet upright');
  assert.equal(wallSupported(1920, 1080), true);
  assert.equal(wallSupported(402, 874), false, 'a phone');
  assert.equal(wallSupported(874, 402), false, 'a phone on its side is still a phone');

  // Tiles: about one per record, but within a sensible size, with a spare tile waiting beyond every edge
  const few = planWall({ width: 1280, height: 800, count: 12 });
  assert.equal(few.tile, 230, 'a small collection: large tiles, and covers repeat');
  const some = planWall({ width: 1280, height: 800, count: 60 });
  assert.ok(some.tile > 110 && some.tile < 230);
  const many = planWall({ width: 1280, height: 800, count: 5000 });
  assert.equal(many.tile, 110, 'a huge collection: never smaller than 110px');
  for (const p of [few, some, many]) {
    assert.ok(p.cols * p.tile >= 1280 + 2 * p.tile - p.tile, 'covers the screen with a spare tile at each side');
    assert.ok(p.rows * p.tile >= 800 + p.tile);
    assert.equal(p.cells, p.cols * p.rows);
    assert.ok(p.speed >= 3 && p.speed < 10, 'a slow drift, a few pixels a second');
  }

  // What sits where: every record once before any repeats, and no record beside itself, above or below, anywhere
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const n of [1, 2, 3, 6, 12, 51, 300]) {
    const pool = Array.from({ length: n }, (_, i) => ({ id: i }));
    const at = wallPattern(pool, rand);
    assert.equal(new Set(Array.from({ length: n }, (_, c) => at(c, 0).id)).size, n, `a row of ${n} shows each record once`);
    if (n > 1) {
      for (let r = -20; r < 20; r++) {
        for (let c = -20; c < 20; c++) {
          assert.notEqual(at(c, r), at(c + 1, r), `${n}: nothing beside itself`);
          assert.notEqual(at(c, r), at(c, r + 1), `${n}: nothing above itself`);
        }
      }
    }
    assert.equal(at(5, 7), at(5, 7), 'the same place always shows the same record');
  }
  assert.equal(wallPattern([], rand)(3, 4), null, 'nothing to show');

  // The heading turns slowly: a few degrees a minute, all the way round in about twelve minutes, never jumping
  const degrees = (rad) => (rad * 180) / Math.PI;
  const perMinute = degrees(headingAt(60) - headingAt(0));
  assert.ok(Math.abs(perMinute) < 60 && Math.abs(perMinute) > 5, `a gradual turn (${perMinute.toFixed(0)}° a minute)`);
  assert.ok(Math.abs(degrees(headingAt(720) - headingAt(0)) - 360) < 40, 'about one full turn in twelve minutes, give or take the sway');
  let widest = 0;
  for (let t = 0; t < 1800; t += 0.5) widest = Math.max(widest, Math.abs(degrees(headingAt(t + 0.5) - headingAt(t))));
  assert.ok(widest < 1, `never more than a degree in half a second (${widest.toFixed(2)}°)`);
  assert.notEqual(headingAt(0, { start: 1 }), headingAt(0, { start: 2 }), 'each start can face its own way');

  // Tiles that leave one side reappear ahead of the drift on the other
  assert.equal(recycled(10, 200, 2400, 1280, 8), 18, 'gone off the left: moved to the right');
  assert.equal(recycled(20, 200, 2400, 1280, 8), 12, 'beyond the right: moved to the left');
  assert.equal(recycled(15, 200, 2400, 1280, 8), 15, 'on screen: left alone');
  assert.equal(recycled(11, 200, 2400, 1280, 8), 11, 'only just leaving: left alone until it has gone completely');

  // The raised cover leaves room for its title, and is never tiny or enormous
  assert.equal(spotSize(1280, 800), 464);
  assert.equal(spotSize(2560, 1600), 620, 'capped on a big screen');
  assert.equal(spotSize(300, 300), 200, 'and floored');

  // Which tile: inside the screen, not among the recent
  const R = (l, t) => ({ left: l, top: t, right: l + 100, bottom: t + 100 });
  const rects = [R(-50, 100), R(400, 300), R(1250, 300), R(600, 400), R(200, 200)];
  const screen = { width: 1280, height: 800 };
  assert.equal(pickSpot(rects, [], screen, () => 0), 1, 'tiles half off the edge are skipped');
  assert.equal(pickSpot(rects, [1], screen, () => 0), 3, 'so are recent ones');
  assert.equal(pickSpot(rects, [1, 3, 4], screen, () => 0), 1, 'when everything is recent, recent ones are allowed again');
  assert.equal(pickSpot([R(-90, 0)], [], screen), -1, 'nothing suitable on screen');
}


// ---- background jobs run one at a time -------------------------------------------------------------------------
import { createRunOnce } from '../public/js/jobs.js';

{
  const runOnce = createRunOnce();
  let runs = 0;
  let active = 0;
  let overlapped = false;
  const job = async () => {
    runs++;
    active++;
    if (active > 1) overlapped = true;
    await new Promise((r) => setTimeout(r, 15));
    active--;
  };

  // Three requests at once: one run, then one more pass because it was asked for again while running
  await Promise.all([runOnce('years', job), runOnce('years', job), runOnce('years', job)]);
  assert.equal(overlapped, false, 'never two at a time');
  assert.equal(runs, 2, 'and the request that came in mid-run gets one more pass, not two');

  // A single request runs once
  runs = 0;
  await runOnce('years', job);
  assert.equal(runs, 1);

  // Different jobs do not hold each other up
  runs = 0;
  await Promise.all([runOnce('a', job), runOnce('b', job)]);
  assert.equal(runs, 2);

  // A job that fails does not block the next attempt, and the failure is reported to whoever asked
  let attempts = 0;
  await assert.rejects(runOnce('flaky', async () => { attempts++; throw new Error('offline'); }), /offline/);
  await runOnce('flaky', async () => { attempts++; });
  assert.equal(attempts, 2, 'the next request tries again');

  // Everyone who asked while it ran gets the same answer at the same time
  const order = [];
  const slow = async () => { await new Promise((r) => setTimeout(r, 10)); order.push('job'); };
  await Promise.all([runOnce('s', slow).then(() => order.push('first')), runOnce('s', slow).then(() => order.push('second'))]);
  assert.deepEqual(order.slice(0, 2), ['job', 'job'], 'the job (and its extra pass) finishes before either caller carries on');
}

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
import { needsDeezerArt, needsItunesArt, buildCollectionRecord, scoreAlbumMatch, ART_SEARCH_VERSION, needsMasterTitleArt, titlesDiffer, needsDetails } from '../public/js/sync.js';

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
import { needsFullSync, canStopEarly, readSyncMeta, writeSyncMeta, removedRecordIds, needsAutoSync, timeAgo } from '../public/js/syncplan.js';
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
  assert.deepEqual(readSyncMeta('Ryan', storage), { storedTotal: null, lastFullAt: 0, lastCheckedAt: 0 });
  writeSyncMeta('Ryan', { storedTotal: 210, lastFullAt: 5, lastCheckedAt: 9 }, storage);
  assert.deepEqual(readSyncMeta('ryan', storage), { storedTotal: 210, lastFullAt: 5, lastCheckedAt: 9 }, 'usernames are not case sensitive');
  assert.deepEqual(readSyncMeta('x', { getItem() { throw new Error('blocked'); } }), { storedTotal: null, lastFullAt: 0, lastCheckedAt: 0 }, 'blocked storage just means a full read');

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
  assert.deepEqual(s.decades[0].years, [1959], 'each decade lists its years, for the row of spines');
  assert.equal(s.longest.seconds, 600, 'the longest record by playing time');
  assert.equal(s.topArtist.name, 'AFI');
  assert.equal(s.topArtist.records.length, 2, 'and the sleeves to show for them');
  assert.equal(computeStats([rec('x', 'Solo', 2000)]).topArtist, null, 'no favourite when nobody repeats');
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
// a cover: a heart on a colored ground with a text bar, so it has real structure
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

// ---- data health and source stats ---------------------------------------------------------------------
import { computeHealth, describeStorage, healthSummary } from '../public/js/health.js';
import { noteSource, sourceSnapshot, resetSourceStats } from '../public/js/sourcestats.js';

{
  const rec = (id, extra = {}) => ({ id, discogsId: 1, artwork: { source: 'discogs' }, ...extra });
  const records = [
    rec('discogs_1', { masterId: 5, masterYear: 1999, details: { status: 'Accepted' }, artwork: { source: 'deezer' } }),
    rec('discogs_2', { masterId: 6, masterChecked: true, details: { status: 'Accepted' }, artCandidate: { source: 'deezer' }, context: { backCover: 'x' } }),
    rec('discogs_3', { masterId: 7, artworkLocked: true, context: { backCover: null } }),
    rec('discogs_4', { masterId: null, details: { status: 'Draft' } }),
    { id: 'discogs_mock_1', artwork: { source: 'itunes' } },
  ];
  const h = computeHealth(records);
  assert.equal(h.total, 4, 'demo records are not counted');
  assert.equal(h.covers.cleaner, 1);
  assert.equal(h.covers.discogs, 3);
  assert.equal(h.covers.pinned, 1);
  assert.equal(h.covers.offered, 1, 'a Discogs image with another cover on offer');
  assert.deepEqual(h.details, { have: 3, total: 4, custom: 1 });
  assert.deepEqual(h.years, { resolved: 2, total: 3 });
  assert.deepEqual(h.backCovers, { found: 1, none: 1, opened: 2 });
  assert.ok(h.pending.art >= 1 && h.pending.details >= 1, 'work still to do is counted');
  assert.equal(computeHealth([]).total, 0);

  const s = describeStorage({ usage: 5 * 1024 * 1024, quota: 2 * 1024 ** 3, persisted: true });
  assert.equal(s.used, '5.0 MB');
  assert.equal(s.quota, '2048 MB');
  assert.match(s.persisted, /Protected/);
  assert.match(describeStorage({ persisted: false }).persisted, /Not protected/);
  assert.equal(describeStorage({}).used, 'unknown');

  // source stats
  resetSourceStats();
  noteSource('MusicBrainz', true);
  noteSource('MusicBrainz', false, 'answered 503');
  noteSource('Wikipedia', true);
  assert.deepEqual(sourceSnapshot(), [{ name: 'MusicBrainz', ok: 1, failed: 1, last: 'answered 503' }, { name: 'Wikipedia', ok: 1, failed: 0, last: '' }]);
  resetSourceStats();
}

// ---- automatic sync on open, and how it is described ---------------------------------------------------------------
{
  const hour = 3600000;
  const now = Date.parse('2026-09-24T12:00:00Z');
  assert.equal(needsAutoSync({ lastCheckedAt: 0 }, now), true, 'never checked: check now');
  assert.equal(needsAutoSync({ lastCheckedAt: now - 2 * hour }, now), false, 'checked recently: leave it');
  assert.equal(needsAutoSync({ lastCheckedAt: now - 7 * hour }, now), true, 'a while ago: check on open');

  assert.equal(timeAgo(0, now), 'never');
  assert.equal(timeAgo(now - 20000, now), 'just now');
  assert.equal(timeAgo(now - 60000, now), '1 minute ago');
  assert.equal(timeAgo(now - 5 * 60000, now), '5 minutes ago');
  assert.equal(timeAgo(now - hour, now), '1 hour ago');
  assert.equal(timeAgo(now - 5 * hour, now), '5 hours ago');
  assert.equal(timeAgo(now - 49 * hour, now), '2 days ago');
  assert.equal(timeAgo(now + 5000, now), 'just now', 'a clock that ran slightly ahead never shows a negative time');

  assert.equal(healthSummary({ total: 0, pending: { art: 0, details: 0 } }), 'Nothing to report yet');
  assert.equal(healthSummary({ total: 50, pending: { art: 0, details: 0 } }), 'All caught up');
  assert.equal(healthSummary({ total: 50, pending: { art: 3, details: 10 } }), 'Filling in 10 details and 3 covers');
  assert.equal(healthSummary({ total: 50, pending: { art: 3, details: 0 } }), 'Filling in 3 covers');
}

// ---- fun stats and curiosities -------------------------------------------------------------------------------------
{
  const { computeStats, computeFunStats } = await import('../public/js/stats.js');
  const { statsHTML } = await import('../public/js/statsview.js');

  const testRecords = [
    {
      id: 'r1',
      title: 'Kind of Blue',
      artist: 'Miles Davis',
      year: 1959,
      dateAdded: '2023-01-15T10:00:00Z',
      tracklist: [
        { title: 'So What', duration: '9:22' },
        { title: 'All Blues', duration: '11:33' },
      ],
    },
    {
      id: 'r2',
      title: 'A Love Supreme',
      artist: 'John Coltrane',
      year: 1965,
      dateAdded: '2023-01-15T11:00:00Z',
      tracklist: [
        { title: 'Part I', duration: '7:42' },
        { title: 'Part II', duration: '17:50' },
      ],
    },
    {
      id: 'r3',
      title: 'Boston',
      artist: 'Boston',
      year: 1976,
      dateAdded: '2024-05-20T14:00:00Z',
      tracklist: [
        { title: 'More Than a Feeling', duration: '4:45' },
        { title: 'Peace of Mind', duration: '5:02' },
        { title: 'Foreplay / Long Time', duration: '7:48' },
      ],
    },
    {
      id: 'r4',
      title: 'Third',
      artist: 'Soft Machine',
      year: 1970,
      dateAdded: '2024-06-01T12:00:00Z',
      tracklist: [
        { title: 'Facelift', duration: '18:45' },
        { title: 'Slightly All the Time', duration: '18:12' },
        { title: 'Moon in June', duration: '19:08' },
      ],
    },
  ];

  const fun = computeFunStats(testRecords);
  assert.ok(fun.length > 0, 'generates fun stats from records');
  assert.ok(fun.some((f) => f.id === 'first-added'), 'identifies first added record');
  assert.ok(fun.some((f) => f.id === 'biggest-haul-day'), 'identifies single-day haul');
  assert.ok(fun.some((f) => f.id === 'longest-track'), 'identifies longest track');

  const stats = computeStats(testRecords);
  assert.ok(stats.standoutsPool && stats.standoutsPool.length > 0, 'builds standoutsPool');
  const html = statsHTML(stats);
  assert.ok(html.includes('Fun facts'), 'renders the Fun facts section');
}

// ---- lyrics helpers --------------------------------------------------------------------------------------------
{
  assert.equal(cleanArtistName('Nirvana (2)'), 'Nirvana');
  assert.equal(cleanArtistName('Miles Davis'), 'Miles Davis');
  assert.equal(cleanArtistName(''), '');

  assert.equal(cleanTrackTitle('01. Come Together'), 'Come Together');
  assert.equal(cleanTrackTitle('A1. Blue in Green'), 'Blue in Green');
  assert.equal(cleanTrackTitle('Here Comes the Sun - 2019 Mix'), 'Here Comes the Sun');
  assert.equal(cleanTrackTitle('Paranoid Android (Remastered 2011)'), 'Paranoid Android');
  assert.equal(cleanTrackTitle('Time [Bonus Track]'), 'Time');
  assert.equal(cleanTrackTitle('Speak to Me'), 'Speak to Me');

  assert.equal(parseDurationToSeconds('4:20'), 260);
  assert.equal(parseDurationToSeconds('0:45'), 45);
  assert.equal(parseDurationToSeconds('1:02:15'), 3735);
  assert.equal(parseDurationToSeconds(''), null);
  assert.equal(parseDurationToSeconds('invalid'), null);

  assert.equal(formatLyricsHTML(''), '');
  const formatted = formatLyricsHTML('Line 1\nLine 2\n\nLine 3 <script>');
  assert.ok(formatted.includes('<p class="lyrics-stanza">Line 1<br>Line 2</p>'));
  assert.ok(formatted.includes('&lt;script&gt;'), 'escapes HTML tags');
  assert.ok(!formatted.includes('<script>'), 'no unescaped scripts');
}

// ---- track normalization & duration matching --------------------------------------------------
{
  // Part / Pt and Roman numerals
  assert.equal(normalizeTrackTitle('Encom Part 1'), 'encompart1');
  assert.equal(normalizeTrackTitle('Encom, Pt. I'), 'encompart1');
  assert.equal(normalizeTrackTitle('Encom, Pt. 1'), 'encompart1');
  assert.equal(normalizeTrackTitle('Encom Part One'), 'encompart1');
  assert.equal(normalizeTrackTitle('Encom Part 2'), 'encompart2');
  assert.equal(normalizeTrackTitle('Encom, Pt. II'), 'encompart2');
  assert.equal(normalizeTrackTitle('Encom, Pt. 2'), 'encompart2');

  // Featuring abbreviations (feat., feat, ft., ft, featuring, with, w/)
  const feat1 = normalizeTrackTitle('Get Lucky (feat. Pharrell)');
  const feat2 = normalizeTrackTitle('Get Lucky (ft. Pharrell)');
  const feat3 = normalizeTrackTitle('Get Lucky [featuring Pharrell]');
  const feat4 = normalizeTrackTitle('Get Lucky feat Pharrell');
  const feat5 = normalizeTrackTitle('Get Lucky (with Pharrell)');
  const feat6 = normalizeTrackTitle('Get Lucky (w/ Pharrell)');
  assert.equal(feat1, 'getluckyfeatpharrell');
  assert.equal(feat1, feat2);
  assert.equal(feat1, feat3);
  assert.equal(feat1, feat4);
  assert.equal(feat1, feat5);
  assert.equal(feat1, feat6);

  // Common symbols and abbreviations: &, vs., vol., no., ver.
  assert.equal(normalizeTrackTitle('Rock & Roll'), normalizeTrackTitle('Rock and Roll'));
  assert.equal(normalizeTrackTitle('Godzilla vs. Kong'), normalizeTrackTitle('Godzilla vs Kong'));
  assert.equal(normalizeTrackTitle('Kill Bill Vol. 1'), normalizeTrackTitle('Kill Bill Volume I'));
  assert.equal(normalizeTrackTitle('Symphony No. 5'), normalizeTrackTitle('Symphony #5'));
  assert.equal(normalizeTrackTitle('Symphony #5'), normalizeTrackTitle('Symphony 5'));

  // Stripping audio tags
  assert.equal(normalizeTrackTitle('Track Title (Album Version)'), 'tracktitle');
  assert.equal(normalizeTrackTitle('Track Title - 2011 Remaster'), 'tracktitle');
  assert.equal(normalizeTrackTitle('Track Title (Remastered 2021)'), 'tracktitle');

  // stripFeaturing helper
  assert.equal(stripFeaturing('Starboy (feat. Daft Punk)'), 'Starboy');
  assert.equal(stripFeaturing('Starboy (ft. Daft Punk)'), 'Starboy');
  assert.equal(stripFeaturing('Starboy [featuring Daft Punk]'), 'Starboy');
  assert.equal(stripFeaturing('Starboy feat. Daft Punk'), 'Starboy');
  assert.equal(stripFeaturing('Starboy ft. Daft Punk'), 'Starboy');
  assert.equal(stripFeaturing('Starboy (with Daft Punk)'), 'Starboy');
  assert.equal(stripFeaturing('Starboy (w/ Daft Punk)'), 'Starboy');
  assert.equal(stripFeaturing('Stay With Me'), 'Stay With Me', 'does not strip legitimate English "with"');
}

import { searchWords, matchRecord, fold as foldText } from '../public/js/search.js';
{
  const rec = { title: 'Selected Ambient Works 85-92', artist: 'Aphex Twin', tracklist: [{ title: 'Xtal' }, { title: 'Tha' }, { title: 'Ageispolis' }] };
  const m = (q, r = rec) => matchRecord(r, searchWords(q));
  assert.deepEqual(m(''), { track: null }, 'no words matches everything');
  assert.deepEqual(m('aphex ambient'), { track: null }, 'title and artist words still match the album');
  assert.deepEqual(m('xtal'), { track: 'Xtal', index: 0 }, 'a track title matches');
  assert.deepEqual(m('AGEISPOLIS'), { track: 'Ageispolis', index: 2 }, 'case is ignored');
  assert.deepEqual(m('aphex tha'), { track: 'Tha', index: 1 }, 'artist plus track works');
  assert.equal(m('xtal ageispolis'), null, 'words spread across two tracks do not match');
  assert.equal(m('nothing'), null);
  assert.deepEqual(m('ambient'), { track: null }, 'album match wins over a track match');
  assert.deepEqual(m('cafe', { title: 'X', artist: 'Y', tracklist: [{ title: 'Café del Mar' }] }), { track: 'Café del Mar', index: 0 }, 'accents are folded');
  assert.equal(m('x', { title: 'Q', artist: 'R' }), null, 'records without a tracklist still work');
  assert.equal(foldText('Éclair'), 'eclair');
  console.log('Search tests passed.');
}

// ---- original years from Wikidata, and formats that arrive with the collection list ----------------------------
{
  const { wikidataYearUpdates } = await import('../public/js/years.js');
  const { formatsOf } = await import('../public/js/vinyl.js');
  const { facetsFor } = await import('../public/js/filters.js');

  assert.equal(wikidataYearUpdates({ title: 'Suede', pressingYear: 2011 }, 1993).originalYear, 1993, 'the original year beats a later pressing');
  assert.equal(wikidataYearUpdates({ title: 'Suede', pressingYear: 1990 }, 1993), null, 'an original can not come after the pressing in hand');
  assert.equal(wikidataYearUpdates({ title: 'Suede' }, 1200), null, 'an unbelievable year is ignored');
  assert.equal(wikidataYearUpdates({ title: 'Nevermind (Deluxe)', pressingYear: 2011 }, 1991).year, 2011, 'editions keep their own pressing year');

  const listed = { id: 'a', title: 'A', artist: 'B', year: 1990, listFormats: [{ name: 'Vinyl', qty: '2', descriptions: ['LP', 'Album'], text: 'Red' }] };
  assert.equal(formatsOf(listed).length, 1, 'formats from the collection list are used when details are not in yet');
  assert.deepEqual(formatsOf({ ...listed, details: { formats: [{ name: 'Vinyl' }] } }), [{ name: 'Vinyl' }], 'full details win once they arrive');
  assert.equal(facetsFor([listed]).discs[0]?.key, 'multi', 'filters work from the list alone');
}

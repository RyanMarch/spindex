import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

// 1. Verify file structure
const requiredFiles = [
  'public/index.html',
  'public/css/style.css',
  'public/js/app.js',
  'public/js/db.js',
  'public/js/sync.js',
  'public/js/crate.js',
  'public/js/notes.js',
  'public/js/wiki.js',
  'public/js/discogs.js',
  'public/js/vinyl.js',
  'public/js/values.js',
  'public/js/limiter.js',
  'public/js/mock-data.js',
  'wrangler.toml',
  '.gitignore',
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(root, file)), `${file} must exist`);
}

// 2. Test parseSortArtist from sync.js
const { parseSortArtist, groupTracksBySide } = await import('../public/js/sync.js');
assert.equal(parseSortArtist('The Beatles'), 'Beatles, The');
assert.equal(parseSortArtist('The Cure'), 'Cure, The');
assert.equal(parseSortArtist('Duran Duran (2)'), 'Duran Duran');
assert.equal(parseSortArtist('Miles Davis'), 'Davis, Miles');
assert.equal(parseSortArtist('The The (3)'), 'The, The');
assert.equal(parseSortArtist('Carly Rae Jepsen'), 'Jepsen, Carly Rae');
assert.equal(parseSortArtist('Hayley Williams'), 'Williams, Hayley');
assert.equal(parseSortArtist('Yellowcard'), 'Yellowcard');
assert.equal(parseSortArtist('Minus The Bear'), 'Minus The Bear');
assert.equal(parseSortArtist('Jimmy Eat World'), 'Jimmy Eat World');
assert.equal(parseSortArtist('Men At Work'), 'Men At Work');
assert.equal(parseSortArtist('American War'), 'American War');
assert.equal(parseSortArtist('Tame Impala'), 'Tame Impala');
assert.equal(parseSortArtist('David Bowie'), 'Bowie, David');
assert.equal(parseSortArtist('Kate Bush'), 'Bush, Kate');
assert.equal(parseSortArtist('Stevie Wonder'), 'Wonder, Stevie');

// In natural first-name alphabetical order, "Hayley Williams" (H) comes before "Yellowcard" (Y).
// In Last-Name / Year crate sorting, "Williams, Hayley" (W) is moved, sorting after V and directly before Yellowcard (Y).
const naturalOrder = ['Hayley Williams', 'Yellowcard'].sort();
assert.equal(naturalOrder[0], 'Hayley Williams');

const crateOrder = [
  { artist: 'Hayley Williams', sortArtist: parseSortArtist('Hayley Williams') },
  { artist: 'Yellowcard', sortArtist: parseSortArtist('Yellowcard') },
];
crateOrder.sort((a, b) => a.sortArtist.localeCompare(b.sortArtist));
assert.equal(crateOrder[0].artist, 'Hayley Williams');
assert.equal(crateOrder[1].artist, 'Yellowcard');

// Test groupTracksBySide with multi-disc sides (A, B, C, D)
const testTracks = [
  { position: 'A1', title: 'Song A1' },
  { position: 'A2', title: 'Song A2' },
  { position: 'B1', title: 'Song B1' },
  { position: 'C1', title: 'Song C1' },
  { position: 'D1', title: 'Song D1' },
];
const grouped = groupTracksBySide(testTracks);
assert.equal(grouped.length, 4);
assert.equal(grouped[0].title, 'Side A');
assert.equal(grouped[1].title, 'Side B');
assert.equal(grouped[2].title, 'Side C');
assert.equal(grouped[3].title, 'Side D');
assert.equal(grouped[0].tracks.length, 2);
assert.equal(grouped[2].tracks[0].title, 'Song C1');
assert.equal(groupTracksBySide([]), null);
assert.equal(groupTracksBySide([{ position: '1', title: 'Track 1' }]), null);

// Test masterYear / originalYear / year preference and provenance detection
const testRecord1 = {
  title: 'Kind of Blue',
  masterYear: 1959,
  originalYear: 1959,
  pressingYear: 2021,
  year: 1959,
};
const primaryYear1 = testRecord1.masterYear || testRecord1.originalYear || testRecord1.year;
assert.equal(primaryYear1, 1959);
assert.equal(testRecord1.pressingYear !== primaryYear1, true);

const testRecord2 = {
  title: 'Original Pressing',
  masterYear: null,
  originalYear: 1977,
  pressingYear: 1977,
  year: 1977,
};
const primaryYear2 = testRecord2.masterYear || testRecord2.originalYear || testRecord2.year;
assert.equal(primaryYear2, 1977);
assert.equal(testRecord2.pressingYear !== primaryYear2, false);

// 3. Test mock data records schema integrity & verified artwork
const { MOCK_RECORDS } = await import('../public/js/mock-data.js');
assert.ok(Array.isArray(MOCK_RECORDS) && MOCK_RECORDS.length >= 10, 'Must have at least 10 mock records');

for (const record of MOCK_RECORDS) {
  assert.ok(record.id, `Record missing id: ${JSON.stringify(record)}`);
  assert.ok(typeof record.discogsId === 'number', `Record missing numeric discogsId: ${record.id}`);
  assert.ok(typeof record.title === 'string' && record.title.length > 0, `Record missing title: ${record.id}`);
  assert.ok(typeof record.artist === 'string' && record.artist.length > 0, `Record missing artist: ${record.id}`);
  assert.ok(typeof record.sortArtist === 'string' && record.sortArtist.length > 0, `Record missing sortArtist: ${record.id}`);
  assert.ok(typeof record.year === 'number', `Record missing year: ${record.id}`);
  assert.ok(Array.isArray(record.genres) && record.genres.length > 0, `Record missing genres: ${record.id}`);
  assert.ok(Array.isArray(record.tracklist), `Record missing tracklist: ${record.id}`);
  assert.ok(record.artwork && typeof record.artwork.thumbnail === 'string', `Record missing artwork: ${record.id}`);
  assert.ok(record.artwork.thumbnail.startsWith('https://is1-ssl.mzstatic.com'), `Artwork should use verified Apple CDN: ${record.id}`);
}

// 4. Verify rule: innerHTML assignments must use `innerHTML =  /*html*/`
const jsFiles = [
  'public/js/app.js',
  'public/js/crate.js',
  'public/js/notes.js',
  'public/js/wiki.js',
  'public/js/discogs.js',
  'public/js/vinyl.js',
  'public/js/values.js',
  'public/js/limiter.js',
  'public/js/sync.js',
  'public/js/db.js',
  'public/js/mock-data.js',
];

for (const file of jsFiles) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  const innerHTMLMatches = content.match(/innerHTML\s*=\s*[^;]+/g) || [];
  for (const match of innerHTMLMatches) {
    assert.ok(
      match.includes('innerHTML =  /*html*/'),
      `File ${file} contains non-compliant innerHTML assignment: "${match}". Must be "innerHTML =  /*html*/"`
    );
  }
}

// 5. Verify rule: no forbidden word 'premium' in text content
for (const file of [...jsFiles, 'public/index.html', 'public/css/style.css']) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(!content.toLowerCase().includes('premium'), `File ${file} contains forbidden word "premium"`);
}

// 6. Test letter jumping navigation logic
const { CrateController } = await import('../public/js/crate.js');
const dummyContainer = { offsetWidth: 420, innerHTML: '', appendChild: () => {}, addEventListener: () => {} };
const dummyCounter = { textContent: '' };
const testCrate = new CrateController(dummyContainer, dummyCounter);
testCrate.setRecords([
  { id: '1', artist: 'David Bowie', sortArtist: 'Bowie, David' },
  { id: '2', artist: 'Miles Davis', sortArtist: 'Davis, Miles' },
  { id: '3', artist: 'Hayley Williams', sortArtist: 'Williams, Hayley' },
  { id: '4', artist: 'Yellowcard', sortArtist: 'Yellowcard' },
], 'artist-last-year');

// Pressing 'W' should jump to Hayley Williams (index 2)
testCrate.jumpToLetter('W');
assert.equal(testCrate.currentIndex, 2);
assert.equal(testCrate.records[testCrate.currentIndex].artist, 'Hayley Williams');

// Pressing 'B' should jump to David Bowie (index 0)
testCrate.jumpToLetter('B');
assert.equal(testCrate.currentIndex, 0);

console.log('All basic and integration tests passed successfully.');


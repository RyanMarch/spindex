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
  'public/js/mock-data.js',
  'public/js/audio.js',
  'wrangler.toml',
  '.gitignore',
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(root, file)), `${file} must exist`);
}

// 2. Test parseSortArtist from sync.js
const { parseSortArtist } = await import('../public/js/sync.js');
assert.equal(parseSortArtist('The Beatles'), 'Beatles, The');
assert.equal(parseSortArtist('The Cure'), 'Cure, The');
assert.equal(parseSortArtist('Duran Duran (2)'), 'Duran Duran');
assert.equal(parseSortArtist('Miles Davis'), 'Miles Davis');
assert.equal(parseSortArtist('The The (3)'), 'The, The');

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
  'public/js/sync.js',
  'public/js/db.js',
  'public/js/mock-data.js',
  'public/js/audio.js',
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

console.log('All basic and integration tests passed successfully.');

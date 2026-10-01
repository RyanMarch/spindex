// The fun facts worked out from inside each record: labels, credits, studios, countries, formats, titles.
import assert from 'node:assert/strict';
import { computeCollectionFacts } from '../public/js/stats-facts.js';
import { computeStats } from '../public/js/stats.js';
import { renderStandoutItem } from '../public/js/statsview.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const facts = (records) => Object.fromEntries(computeCollectionFacts(records, { now: NOW }).map((f) => [f.id, f]));

let n = 0;
// A record with whatever the test cares about; everything else is left out on purpose
const rec = (artist, title, extra = {}) => ({ id: `r${++n}`, artist, title, year: 1980, genres: ['Rock'], ...extra });
const withDetails = (details, extra = {}) => ({ details: { labels: [], credits: [], companies: [], artists: [], formats: [], country: '', ...details }, ...extra });
const credit = (name, role, id = null) => ({ id, name, role });

// ---- nothing to say about a tiny or bare crate -----------------------------------------------------------------------
assert.deepEqual(computeCollectionFacts([], { now: NOW }), []);
assert.deepEqual(computeCollectionFacts(null), []);
assert.deepEqual(computeCollectionFacts([rec('A', 'One'), rec('B', 'Two')], { now: NOW }), [], 'a couple of bare records have no facts of this kind');

// ---- labels, studios, plants: counted once per record, spellings merged, self-released left out ----------------------
{
  const label = (name) => withDetails({ labels: [{ name, catno: '' }] });
  const records = [
    rec('A', 'a1', label('Columbia')), rec('B', 'b1', label('Columbia Records')), rec('C', 'c1', label('COLUMBIA')),
    rec('D', 'd1', label('Blue Note')), rec('E', 'e1', label('Not On Label')), rec('F', 'f1', label('Not On Label')),
    rec('G', 'g1', label('Not On Label')),
  ];
  const f = facts(records);
  assert.equal(f['top-label'].title, 'Columbia', 'the spelling used most often is shown, and Records is not a different label');
  assert.equal(f['top-label'].detail, '3 records');
  assert.equal(f['top-label'].type, 'fan');
  assert.equal(f['top-label'].records.length, 3);

  // fewer than six records with details: not enough to call anything common
  assert.equal(facts(records.slice(0, 5))['top-label'], undefined, 'too few records to say');
  // the front-runner needs three
  assert.equal(facts(['X', 'Y', 'Z', 'W', 'V', 'U'].map((n1, i) => rec(n1, `t${i}`, label(i < 2 ? 'Alpha' : `Solo ${i}`))))['top-label'], undefined, 'two is not enough');

  const tied = facts([...records.slice(0, 3), ...['Z1', 'Z2', 'Z3'].map((t) => rec('Z', t, label('Verve')))]);
  assert.ok(/tied with 1 other$/.test(tied['top-label'].detail), 'a tie is said out loud');

  const studio = (name, role) => withDetails({ companies: [{ name, role }] });
  const sessions = [
    ...['a', 'b', 'c'].map((t) => rec('S', t, studio('Abbey Road Studios', 'Recorded At'))),
    ...['d', 'e', 'f'].map((t) => rec('T', t, studio('Sterling Sound', 'Mastered At'))),
    ...['g', 'h', 'i'].map((t) => rec('U', t, studio('Pallas', 'Pressed By'))),
  ];
  const s = facts(sessions);
  assert.equal(s['top-studio'].title, 'Abbey Road Studios');
  assert.equal(s['top-mastering'].title, 'Sterling Sound');
  assert.equal(s['top-plant'].title, 'Pallas');
  assert.equal(s['top-plant'].detail, '3 records pressed here');
}

// ---- credits: performers (not the record's own artist), producers, writers, cover credits ----------------------------
{
  const session = (extra) => withDetails({ artists: [{ id: 1, name: 'Band' }], credits: [], ...extra });
  const records = [1, 2, 3, 4, 5, 6].map((i) => rec('Band', `Record ${i}`, session({
    credits: [
      credit('Herbie Hancock', 'Piano, Keyboards', 55),
      ...(i <= 3 ? [credit('Rick Rubin', 'Producer', 77)] : []),
      ...(i <= 4 ? [credit('Band', 'Guitar'), credit('Lennon', 'Written-By', 9)] : []),
      ...(i >= 4 ? [credit('Storm T', 'Artwork, Design', 12)] : []),
      ...(i === 1 ? [credit('Engineer Pat', 'Engineer [Assistant]'), credit('Someone', 'Producer [Assistant]', 88)] : []),
    ],
  })));
  const f = facts(records);
  assert.equal(f['top-performer'].title, 'Herbie Hancock');
  assert.equal(f['top-performer'].detail, 'Credited on 6 records');
  assert.equal(f['top-producer'].title, 'Rick Rubin');
  assert.equal(f['top-producer'].detail, 'Produced 3 records', 'an assistant producer is not a producer');
  assert.equal(f['top-writer'].title, 'Lennon');
  assert.equal(f['top-writer'].records.length, 4);
  assert.equal(f['top-cover-credit'].title, 'Storm T');
  assert.equal(f['top-cover-credit'].detail, 'Credited on 3 covers');

  // the record's own artist is left out of "most common performer", however often they are credited
  const selfCredited = [1, 2, 3, 4, 5, 6].map((i) => rec('Band', `R${i}`, session({ credits: [credit('Band', 'Vocals', 1), credit('Band', 'Guitar', 1)] })));
  assert.equal(facts(selfCredited)['top-performer'], undefined);

  // fewer than six records with credits: no claims
  assert.equal(facts(records.slice(0, 5))['top-performer'], undefined);

  const crowd = [...records.slice(0, 5), rec('Big', 'Big Band', session({ credits: Array.from({ length: 12 }, (_, i) => credit(`Player ${i}`, 'Horns', 100 + i)) }))];
  assert.equal(facts(crowd)['most-credited'].record.title, 'Big Band');
  assert.equal(facts(crowd)['most-credited'].detail, '12 people');
}

// ---- countries ----------------------------------------------------------------------------------------------------
{
  const made = (country) => withDetails({ country });
  const records = ['US', 'US', 'US', 'UK', 'Japan', 'Germany'].map((c, i) => rec('A', `t${i}`, made(c)));
  assert.equal(facts(records).countries.title, '4 countries');
  assert.equal(facts(records).countries.detail, 'Most pressings from US (3)');
  assert.equal(facts(['US', 'US', 'UK', 'UK', 'US', 'UK'].map((c, i) => rec('A', `t${i}`, made(c)))).countries, undefined, 'two countries is not worth a fact');
}

// ---- formats: reissues, limited editions, multi-disc sets ---------------------------------------------------------
{
  const pressing = (descriptions, qty = 1, text = '') => ({ listFormats: [{ name: 'Vinyl', qty: String(qty), descriptions, text }] });
  const records = [
    rec('A', 'a', pressing(['LP', 'Album', 'Reissue'])), rec('B', 'b', pressing(['LP', 'Repress'])), rec('C', 'c', pressing(['LP', 'Album'])),
    rec('D', 'd', pressing(['LP', 'Album', 'Limited Edition'], 1)), rec('E', 'e', pressing(['LP', 'Limited Edition', 'Reissue'])),
    rec('F', 'f', pressing(['LP'], 2)), rec('G', 'g', pressing(['LP'], 3)), rec('H', 'h', pressing(['LP'])), rec('I', 'i', pressing(['LP'])),
    rec('J', 'j', pressing(['LP'])),
  ];
  const f = facts(records);
  assert.equal(f['reissue-share'].title, '30% reissues');
  assert.equal(f['reissue-share'].detail, '3 of 10 are reissues or repressings');
  assert.equal(f['limited-editions'].title, '2 limited editions');
  assert.equal(f['multi-disc'].title, '2 multi-disc sets');
  assert.equal(f['multi-disc'].detail, '3 discs: g');
  assert.equal(facts(records.slice(0, 9))['reissue-share'], undefined, 'nine records is too few to give a share');
}

// ---- years: the gap between first release and your pressing, and the average age ---------------------------------------
{
  const records = [
    rec('A', 'Old', { year: 1959, masterYear: 1959, originalYear: 1959, pressingYear: 2021 }), rec('B', 'Close', { year: 1980, masterYear: 1980, originalYear: 1980, pressingYear: 1982 }),
    ...[1970, 1980, 1990, 2000, 2010, 2020].map((y, i) => rec('C', `Plain ${i}`, { year: y })),
  ];
  const f = facts(records);
  assert.equal(f['reissue-gap'].record.title, 'Old');
  assert.equal(f['reissue-gap'].detail, 'Pressed 2021, first out 1959');
  assert.equal(facts([rec('A', 'x', { year: 1980, masterYear: 1980, originalYear: 1980, pressingYear: 1982 }), ...records.slice(2)])['reissue-gap'], undefined, 'a gap of two years is not a fact');
  // The real case: Abbey Road is shown as 1969 (its original year) and pressed in 2021; "Millennium 2.0" is an edition, so the app
  // files it under its own year (2025) even though its master says 1999. The 52-year gap is Abbey Road's, not the edition's.
  const abbeyRoad = rec('The Beatles', 'Abbey Road', { year: 1969, masterYear: 1969, originalYear: 1969, pressingYear: 2021 });
  const millennium = rec('Backstreet Boys', 'Millennium 2.0', { year: 2025, masterYear: 1999, originalYear: 2025, pressingYear: 2025 });
  const real = facts([millennium, abbeyRoad, ...records.slice(2)])['reissue-gap'];
  assert.equal(real.record.title, 'Abbey Road');
  assert.equal(real.detail, 'Pressed 2021, first out 1969');
  assert.equal(facts([millennium, ...records.slice(2)])['reissue-gap'], undefined, 'an expanded edition is not a reissue of the original');
  assert.equal(facts([rec('X', 'No pressing year', { year: 1959, masterYear: 1959 }), ...records.slice(2)])['reissue-gap'], undefined, 'without a pressing year there is no gap to measure');
  const older = rec('X', 'Older record', { year: 1959, masterYear: 1959, originalYear: 1959, ...withDetails({ released: '2021-06-04' }) });
  assert.equal(facts([older, ...records.slice(2)])['reissue-gap'].detail, 'Pressed 2021, first out 1959', 'a record without a stored pressing year uses the year Discogs gives its details');
  // original years where known (1959, 1980, then the six plain ones): ages at 2026 are 67, 46, 56, 46, 36, 26, 16, 6
  assert.equal(f['average-age'].title, '37 years');
}

// ---- titles, letters, songs, words -------------------------------------------------------------------------------------
{
  const song = (title) => ({ title, duration: '3:00' });
  const records = [
    rec('Davis, Miles', 'The Rise and Fall of Ziggy Stardust and the Spiders from Mars', { sortArtist: 'Bowie, David', tracklist: [song('Love Me Do'), song('Crazy Love')] }),
    rec('Dummy Band', 'Dummy', { sortArtist: 'Dummy Band', tracklist: [song('Love Is All'), song('The Love Song'), song('Love')] }),
    ...['Bob', 'Beck', 'Blur', 'Bush'].map((a, i) => rec(a, `Album ${i}`, { sortArtist: `${a}`, tracklist: [song(`Love Story ${i}`)] })),
    rec('Various Artists', 'Compilation', { sortArtist: 'Various Artists', tracklist: [song('Nothing')] }),
    rec('Zed', 'Zed Zed Zed', { sortArtist: 'Zed', tracklist: [song('Untitled 1')] }),
    rec('Q', 'Quiet Night', { sortArtist: 'Q', tracklist: [song('Love Letter')] }),
    rec('R', 'Roadworks', { sortArtist: 'R', tracklist: [song('Love Train')] }),
    rec('Moon', 'Moonrise', { sortArtist: 'Moon', tracklist: [song('Night Shift')] }),
    rec('Nu', 'Nu Album', { sortArtist: 'Nu', tracklist: [song('Daylight')] }),
  ];
  const f = facts(records);
  assert.equal(f['longest-title'].record.title.startsWith('The Rise and Fall'), true);
  assert.equal(f['shortest-title'].record.title, 'Dummy');
  assert.equal(f['busiest-letter'].title, 'B', 'Bowie, Bob, Beck, Blur and Bush are all under B (Various is left out)');
  assert.equal(f['busiest-letter'].detail.startsWith('5 records from artists under B'), true);
  assert.equal(f['total-songs'].title, '15 songs');
  assert.equal(f['common-word'].title, '“love”', 'the most repeated word in song titles, stop words aside');
  assert.ok(/^In 11 song titles/.test(f['common-word'].detail), 'counted once per song: "Crazy Love" and "Love Me Do" are two songs');
  assert.equal(facts(records.slice(0, 9))['total-songs'], undefined, 'too few records with tracklists');
  assert.equal(facts(records.slice(0, 11))['busiest-letter'], undefined, 'eleven records is too few for a busiest letter');
}

// ---- styles ---------------------------------------------------------------------------------------------------------
{
  const styled = (styles) => ({ styles });
  const records = [...Array.from({ length: 4 }, (_, i) => rec('A', `a${i}`, styled(['Art Rock', 'Pop Rock']))), ...Array.from({ length: 4 }, (_, i) => rec('B', `b${i}`, styled(['Jazz-Funk'])))];
  const f = facts(records);
  assert.equal(f['top-style'].title, 'Art Rock', 'ties go to the name that sorts first');
  assert.ok(f['top-style'].detail.endsWith('tied with 2 others'), 'Art Rock, Pop Rock and Jazz-Funk each have four');
}

// ---- they join the panel's pool, and each new card type draws ---------------------------------------------------------
{
  const crate = [1, 2, 3, 4, 5, 6].map((i) => rec('Band', `Record ${i}`, withDetails({ labels: [{ name: 'Verve', catno: '' }], country: i % 2 ? 'US' : 'UK' }, { artwork: { highRes: 'https://x/600x600bb.jpg' } })));
  const pool = computeStats(crate).standoutsPool;
  assert.ok(pool.some((item) => item.id === 'top-label'), 'the label fact is in the pool the panel draws from');
  const html = renderStandoutItem(pool.find((item) => item.id === 'top-label'));
  assert.ok(html.includes('st-fan') && html.includes('Most common label') && html.includes('Verve') && html.includes('6 records'), 'a fan card shows the kicker, the name and the count');
  assert.ok(!renderStandoutItem({ type: 'fan', kicker: 'K', title: '<b>x</b>', detail: 'd', records: [] }).includes('<b>x</b>'), 'names are escaped');
  for (const icon of ['globe', 'repeat', 'layers', 'type', 'music', 'quote', 'sparkles', 'clock']) {
    assert.ok(renderStandoutItem({ type: 'fact', icon, kicker: 'k', title: 't', detail: 'd' }).includes('<svg'), `${icon} has an icon`);
  }
}


// ================= the second round: the physical world, dates, condition, people, wordplay ==========================
import { recordPounds, estimatedPounds, spinsOf, spinsLabel, closestRelatives } from '../public/js/stats-facts.js';

const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, `${message}: ${a} vs ${b}`);
const pressed = (descriptions, qty = 1, name = 'Vinyl') => ({ listFormats: [{ name, qty: String(qty), descriptions, text: '' }] });
const side = (positions, each = '5:00') => positions.map((position) => ({ position, title: `Song ${position}`, duration: each }));
const filler = (count, make) => Array.from({ length: count }, (_, i) => make(i));

// ---- the weight of a record: by disc count, size and weight -----------------------------------------------------------
close(recordPounds(rec('A', 'lp', pressed(['LP', 'Album']))), 0.52, 'an ordinary LP with its jacket is about half a pound');
close(recordPounds(rec('A', 'double', pressed(['LP', 'Album'], 2))), 0.96, 'a double album has two discs and a bigger jacket');
close(recordPounds(rec('A', 'heavy', pressed(['LP', '180 Gram']))), 0.66, 'a 180 gram disc is heavier');
close(recordPounds(rec('A', 'seven', pressed(['7"', '45 RPM']))), 0.16, 'a seven-inch is a fraction');
close(recordPounds(rec('A', 'unknown')), 0.52, 'with nothing to go on, an ordinary LP');
close(recordPounds(rec('A', 'by sides', { tracklist: side(['A1', 'B1', 'C1', 'D1']) })), 0.96, 'four sides make two discs when there is no format');
close(estimatedPounds([rec('A', 'a', pressed(['LP'])), rec('B', 'b', pressed(['LP'], 2))]), 1.48, 'the crate is the sum');
{
  const crate = [...filler(6, (i) => rec(`S${i}`, `s${i}`, pressed(['LP']))), ...filler(4, (i) => rec(`D${i}`, `d${i}`, pressed(['LP'], 2)))];
  assert.equal(computeStats(crate).standoutsPool.find((f) => f.id === 'collection-weight').title, '~7 lbs', 'six singles and four doubles: 6 × 0.52 + 4 × 0.96 = 6.96');
  assert.equal(computeStats(crate).standoutsPool.find((f) => f.id === 'collection-weight').detail, '~3 kg, sleeves and all');
}

// ---- spins for one record: minutes of music at the record's speed -----------------------------------------------------------
{
  const timed = (minutes, extra = {}) => rec('A', `timed ${minutes}`, { tracklist: [{ position: 'A1', title: 'x', duration: `${minutes}:00` }], ...extra });
  assert.equal(spinsOf(timed(45)), 1500, '45 minutes at 33⅓ is 1,500 turns');
  assert.equal(spinsOf(timed(40, pressed(['12"', '45 RPM']))), 1800, 'the same music at 45 turns more');
  assert.equal(spinsOf(timed(3, pressed(['10"', '78 RPM']))), 234, 'a 78');
  assert.equal(spinsOf(rec('A', 'no lengths')), 0);
  assert.equal(spinsLabel(timed(46)), 'about 1,530', 'three significant figures: 1,533 turns');
  assert.equal(spinsLabel(rec('A', 'x', { tracklist: [{ position: 'A1', title: 'x', duration: '45:44' }] })), 'about 1,520', '1,524 turns');
  assert.equal(spinsLabel(timed(3, pressed(['7"', '45 RPM']))), 'about 135', 'a seven-inch single');
  assert.equal(spinsLabel(rec('A', 'no lengths')), '', 'nothing to work from');
  assert.equal(spinsLabel(timed(1)), '', 'under fifty turns is not worth saying');
  // too few turns to be a fact: ten two-minute records come to under a thousand
  assert.equal(facts(filler(10, (i) => rec(`A${i}`, `t${i}`, { tracklist: [{ position: 'A1', title: 'x', duration: '2:00' }] })))['total-spins'], undefined);
}

// ---- sides, needle mileage, the fullest side, shelf space --------------------------------------------------------------
{
  const records = [
    ...filler(7, (i) => rec(`S${i}`, `single ${i}`, { tracklist: side(['A1', 'A2', 'B1', 'B2']) })),             // 7 × 20 min, 2 sides
    rec('Long', 'Long Play', { tracklist: [...side(['A1', 'A2'], '12:30'), ...side(['B1'], '10:00')] }),         // side A is 25:00; 35 min, 2 sides
    rec('Dbl', 'Double', { tracklist: side(['A1', 'B1', 'C1', 'D1'], '10:00') }),                                 // 40 min, 4 sides
    rec('Two', 'Two Discs', { tracklist: [{ position: '1-1', title: 'x', duration: '30:00' }, { position: '2-1', title: 'y', duration: '30:00' }], ...pressed(['LP'], 2) }), // 60 min, 4 sides from the format
  ];
  const f = facts(records);
  assert.equal(f.flips.title, '24 sides to play', '7 × 2 + 2 + 4 + 4');
  // 140 + 35 + 40 + 60 = 275 minutes, at 23 metres a minute
  const miles = (275 * 23) / 1609.34;
  assert.equal(f['needle-mileage'].title, `About ${miles.toFixed(1)} miles`);
  assert.equal(f['needle-mileage'].detail, 'Of groove, start to finish', 'the spins have cards of their own now');
  // 7 × 20 min, 35, 40 and 60 minutes at 33⅓ rpm: 667 × 7 + 1167 + 1333 + 2000 = 9,169 turns
  assert.equal(f['total-spins'].title, 'About 9,170 spins', 'three significant figures: it is an estimate');
  assert.equal(f['total-spins'].detail, 'Playing every record once');
  assert.equal(f['average-spins'].title, 'About 917 spins', '9,169 turns over ten records');
  assert.equal(f['longest-side'].record.title, 'Long Play');
  assert.equal(f['longest-side'].detail, 'Side A · 25:00');
  assert.equal(facts(records.slice(0, 9)).flips, undefined, 'nine records with tracklists is too few');

  // a record at 45 rpm covers more groove a minute
  const fast = [...records.slice(0, 9), rec('Fast', 'Fast', { tracklist: side(['A1', 'B1'], '30:00'), ...pressed(['12"', '45 RPM']) })];
  const slow = [...records.slice(0, 9), rec('Slow', 'Slow', { tracklist: side(['A1', 'B1'], '30:00'), ...pressed(['12"']) })];
  assert.equal(facts(fast)['fastest-spinner'].record.title, 'Fast', 'the one at 45 rpm');
  assert.equal(facts(fast)['fastest-spinner'].detail, '45 rpm · about 2,700 spins', '60 minutes at 45');
  assert.equal(facts(slow)['fastest-spinner'], undefined, 'nothing is faster than 33⅓ here');
  const metres = (list) => Number(/[\d.]+/.exec(facts(list)['needle-mileage'].title)[0]);
  assert.ok(metres(fast) > metres(slow), 'the 45 rpm record adds more groove');
}
{
  // ninety ordinary LPs at 0.17 inches each: 15.3 inches, without a single tracklist
  const crate = filler(90, (i) => rec(`A${i}`, `t${i}`));
  assert.equal(facts(crate)['shelf-space'].title, 'About 1 ft 3 in');
  assert.equal(facts(filler(9, (i) => rec(`A${i}`, `t${i}`)))['shelf-space'], undefined, 'nine records is too few');
  assert.equal(facts(filler(20, (i) => rec(`A${i}`, `t${i}`)))['shelf-space'].title, 'About 3 in', 'a small crate is a few inches: 20 × 0.17 = 3.4');
  assert.equal(facts(filler(10, (i) => rec(`A${i}`, `t${i}`)))['shelf-space'].title, 'About 2 in', 'ten records: 1.7 inches');
  assert.equal(facts(filler(71, (i) => rec(`A${i}`, `t${i}`)))['shelf-space'].title, 'About 1 ft', '71 × 0.17 = 12.07 inches is a foot, with no stray "0 in"');
  // a double album is thicker, and a seven-inch is thin
  assert.equal(facts([...filler(70, (i) => rec(`A${i}`, `t${i}`, pressed(['LP']))), ...filler(20, (i) => rec(`B${i}`, `u${i}`, pressed(['LP'], 2)))])['shelf-space'].title, 'About 1 ft 6 in', '70 × 0.17 + 20 × 0.30 = 17.9 inches');
  assert.equal(facts(filler(139, (i) => rec(`A${i}`, `t${i}`)))['shelf-space'].title, 'About 2 ft', '23.6 inches rounds to two feet, not "1 ft 12 in"');
}

// ---- dates: busiest month, dry spell, collecting since, pace -----------------------------------------------------------
{
  const added = (iso) => rec('A', `added ${iso}`, { dateAdded: `${iso}T12:00:00Z` });
  const records = ['2021-01-10', '2021-03-10', '2021-06-10', '2022-09-10', '2022-12-10', '2023-11-01', '2023-11-02', '2023-11-03', '2023-11-04', '2023-11-05', '2024-02-10', '2024-04-10'].map(added);
  const f = facts(records);
  assert.equal(f['busiest-month'].title, 'Nov 2023');
  assert.equal(f['busiest-month'].detail, '5 records added');
  assert.equal(f['dry-spell'].title, '15 months', 'Jun 2021 to Sep 2022 is 457 days');
  assert.equal(f['dry-spell'].detail, 'Nothing added, Jun 2021 to Sep 2022');
  assert.equal(f['collecting-since'].title, 'Jan 2021');
  assert.equal(f['collecting-since'].detail, '5 years and 12 records on', 'at mid-2026');
  assert.equal(f.pace.title, 'Every 108 days', '1186 days across 11 gaps');
  assert.equal(facts(records.slice(0, 9))['busiest-month'], undefined, 'nine dated records is too few');
  // a burst of adds inside two months: no dry spell, no "collecting since", but a pace
  const burst = filler(12, (i) => rec('B', `b${i}`, { dateAdded: `2025-0${1 + Math.floor(i / 6)}-${String(1 + i * 4).padStart(2, '0')}T12:00:00Z` }));
  assert.equal(facts(burst)['dry-spell'], undefined);
  assert.equal(facts(burst)['collecting-since'], undefined, 'a year is needed before it is a history');
}

// ---- a pressing's birthday -----------------------------------------------------------------------------------------------
{
  const released = (date, extra = {}) => rec('A', `out ${date}`, withDetails({ released: date }, extra));
  const crate = (...special) => [...special, ...filler(6, (i) => released('1970-01-01', { title: `filler ${i}` }))];
  const at = (iso) => new Date(`${iso}T12:00:00Z`);
  const check = (when, ...special) => computeCollectionFacts(crate(...special), { now: at(when) }).find((f) => f.id === 'next-birthday');

  const kob = released('1959-08-17', { title: 'Kind of Blue' });
  assert.equal(check('2026-08-05', kob).detail, 'Turns 67 in 12 days');
  assert.equal(check('2026-08-16', kob).detail, 'Turns 67 tomorrow');
  assert.equal(check('2026-08-17', kob).detail, 'Turns 67 today');
  assert.equal(check('2026-05-01', kob), undefined, 'more than two months away is not news');
  assert.equal(check('2026-08-18', kob), undefined, 'the next one is a year off');
  assert.equal(check('2026-08-05', released('1959-08', { title: 'Month only' })), undefined, 'a date without a day has no birthday');
  assert.equal(check('2026-08-05', released('1959', { title: 'Year only' })), undefined);
  assert.equal(check('2026-08-05', released('1959-13-40', { title: 'Nonsense' })), undefined, 'nonsense dates are ignored');
  const reissued = released('2021-08-17', { title: 'Reissue', year: 1959, originalYear: 1959, pressingYear: 2021 });
  assert.equal(check('2026-08-05', reissued).detail, 'Pressing turns 5 in 12 days', 'a reissue is about the pressing, not the album');
  assert.equal(check('2026-08-05', released('1959-08-01', { title: 'Just passed' }), released('1960-08-15', { title: 'Coming up' })).record.title, 'Coming up', 'one that just passed is a year away, so the next to come wins');
  assert.equal(check('2026-08-05', released('1959-08-10', { title: 'Sooner' }), released('1960-08-15', { title: 'Later' })).record.title, 'Sooner', 'of two coming up, the sooner');
}

// ---- condition: the grades you gave ---------------------------------------------------------------------------------------
{
  const graded = (media, sleeve, title) => rec('A', title, { mediaCondition: media, sleeveCondition: sleeve });
  const records = [
    graded('Mint (M)', 'Mint (M)', 'one'), graded('Near Mint (NM or M-)', 'Very Good (VG)', 'two'), graded('Near Mint (NM or M-)', 'Near Mint (NM or M-)', 'three'),
    graded('Very Good Plus (VG+)', 'Near Mint (NM or M-)', 'four'), graded('Very Good (VG)', 'Very Good Plus (VG+)', 'five'),
    graded('Good Plus (G+)', 'Good (G)', 'six'), graded('Good (G)', 'Good (G)', 'seven'), graded('Generic', '', 'eight'),
  ];
  const f = facts(records);
  assert.equal(f['condition-nm'].title, '43% Near Mint or better');
  assert.equal(f['condition-nm'].detail, '3 of 7 graded records', 'Generic is not a grade');
  assert.equal(f['sleeve-worse'].title, '2 rougher sleeves');
  assert.equal(f['sleeve-better'].title, '2 better sleeves');
  assert.equal(f['roughest-record'].record.title, 'seven');
  assert.equal(f['roughest-record'].detail, 'Good (G)');
  assert.equal(facts(records.slice(0, 5))['condition-nm'], undefined, 'five graded records is too few');
  assert.equal(facts([...records.slice(0, 3), ...filler(4, (i) => graded('Mint (M)', 'Mint (M)', `m${i}`))])['roughest-record'], undefined, 'nothing rough enough to name');
}

// ---- duplicates, title tracks, mono, odd sizes ----------------------------------------------------------------------------
{
  const others = filler(6, (i) => rec(`O${i}`, `other ${i}`, { masterId: 100 + i }));
  const f = facts([rec('M', 'Kind of Blue', { masterId: 5 }), rec('M', 'Kind of Blue (Reissue)', { masterId: 5 }), rec('M', 'Kind of Blue (Mono)', { masterId: 5 }),
    rec('N', 'Dummy', { masterId: 6 }), rec('N', 'Dummy (2014)', { masterId: 6 }), ...others]);
  assert.equal(f.duplicates.title, 'Kind of Blue');
  assert.equal(f.duplicates.detail, '3 pressings · 2 albums have twins');
  assert.equal(f.duplicates.records.length, 3);
  const noMaster = facts([rec('X', 'Same Album'), rec('X', 'same album!'), ...others]);
  assert.equal(noMaster.duplicates.title, 'Same Album', 'without a master, the same artist and title is the same album');
  assert.equal(facts(others).duplicates, undefined);
}
{
  const song = (title) => ({ title, duration: '3:00' });
  const crate = [rec('A', 'London Calling', { tracklist: [song('London Calling')] }), rec('B', 'Hounds of Love', { tracklist: [song('Hounds of Love!')] }),
    rec('C', 'Nope', { tracklist: [song('Other')] }), ...filler(8, (i) => rec(`F${i}`, `filler ${i}`, { tracklist: [song(`tune ${i}`)] }))];
  assert.equal(facts(crate)['title-tracks'].title, '2 title tracks');
  assert.equal(facts(crate)['title-tracks'].detail, 'Like London Calling');
  assert.equal(facts(crate.slice(1))['title-tracks'], undefined, 'one is not a pattern');
}
{
  const crate = [
    ...filler(2, (i) => rec(`M${i}`, `mono ${i}`, pressed(['LP', 'Mono']))), ...filler(3, (i) => rec(`S${i}`, `seven ${i}`, pressed(['7"', '45 RPM']))),
    rec('T', 'ten', pressed(['10"'])), rec('F', 'fast', pressed(['12"', '45 RPM'])), ...filler(3, (i) => rec(`L${i}`, `plain ${i}`, pressed(['LP', 'Stereo']))),
  ];
  const f = facts(crate);
  assert.equal(f.mono.title, '2 mono pressings');
  assert.equal(f.mono.detail, '20% of your records');
  assert.equal(f['odd-sizes'].title, '5 off the usual');
  assert.equal(f['odd-sizes'].detail, '3 seven-inches · 1 ten-inch · 1 at 45 rpm', 'a seven-inch at 45 is not also counted as a fast twelve');
  assert.equal(facts(filler(10, (i) => rec(`L${i}`, `plain ${i}`, pressed(['LP']))))['odd-sizes'], undefined);
}

// ---- people: relatives, multi-instrumentalists, do-it-yourself, label loyalty ----------------------------------------------
{
  const made = (artist, title, credits, extra = {}) => rec(artist, title, withDetails({ artists: [{ id: artist.length, name: artist }], credits }, extra));
  const crew = (...ids) => ids.map((id) => credit(`Person ${id}`, 'Guitar', id));
  const records = [
    made('Artist A', 'First', crew(1, 2, 3, 4, 5)), made('Artist B', 'Second', crew(1, 2, 3, 4, 5)), made('Artist A', 'Third', crew(1, 2, 3)),
    ...filler(4, (i) => made(`Solo ${i}`, `Solo ${i}`, crew(100 + i))),
  ];
  const f = facts(records);
  assert.equal(f['closest-relatives'].title, 'First and Second');
  assert.equal(f['closest-relatives'].detail, '5 people credited on both');
  assert.deepEqual(f['closest-relatives'].records.map((r) => r.title), ['First', 'Second']);
  // the threshold can be lowered to see how near a crate came: two people are shared between First and Second here too
  const near = closestRelatives([made('Artist A', 'One', crew(1, 2)), made('Artist B', 'Two', crew(1, 2, 3)), ...records.slice(3)], 1);
  assert.equal(near.count, 2);
  assert.equal(closestRelatives([made('Artist A', 'One', crew(1, 2)), made('Artist B', 'Two', crew(1, 2))]), null, 'two shared people is under the usual four');
  // two records by one artist are not relatives; four shared people are needed
  assert.equal(facts([made('Same', 'A', crew(1, 2, 3, 4, 5)), made('Same', 'B', crew(1, 2, 3, 4, 5)), ...records.slice(3)])['closest-relatives'], undefined);
  assert.equal(facts([made('Artist A', 'First', crew(1, 2, 3)), made('Artist B', 'Second', crew(1, 2, 3)), ...records.slice(3)])['closest-relatives'], undefined);

  const parts = ['Guitar', 'Bass', 'Drums', 'Piano [Grand]', 'Vocals'];
  const band = parts.map((role, i) => made(`Act ${i}`, `Act ${i}`, [credit('Prince Nelson', role, 500)]));
  const m = facts([...band, made('Other', 'Other', [credit('Nobody', 'Bass', 600)])])['multi-instrumentalist'];
  assert.equal(m.title, 'Prince Nelson');
  assert.equal(m.detail, 'Plays 5 different parts across your crate', 'Piano [Grand] is Piano');
  assert.equal(facts([...band.slice(0, 4), made('Other', 'Other', [credit('Nobody', 'Bass', 600)]), ...filler(2, (i) => made(`X${i}`, `X${i}`, [credit('Nobody', 'Bass', 600)]))])['multi-instrumentalist'], undefined, 'four parts is not enough');

  const diy = filler(3, (i) => made(`Maker ${i}`, `Album ${i}`, [credit(`Maker ${i}`, 'Producer', 700 + i)]));
  const d = facts([...diy, ...filler(3, (i) => made(`Other ${i}`, `Other ${i}`, [credit('Someone Else', 'Producer', 800)]))])['self-produced'];
  assert.equal(d.title, '3 self-produced');
  assert.equal(d.records.length, 3);
  assert.equal(facts([...diy.slice(0, 2), ...filler(4, (i) => made(`Other ${i}`, `Other ${i}`, [credit('Someone Else', 'Producer', 800)]))])['self-produced'], undefined, 'two is not a habit');
}
{
  const label = (name) => withDetails({ labels: [{ name, catno: '' }] });
  const crate = [...['A', 'A', 'A', 'A'].map((l, i) => rec(`a${i}`, `a${i}`, label('Alpha'))), ...filler(3, (i) => rec(`b${i}`, `b${i}`, label('Beta'))),
    ...filler(2, (i) => rec(`c${i}`, `c${i}`, label('Gamma'))), rec('d', 'd', label('Delta'))];
  const f = facts(crate);
  assert.equal(f['label-loyalty'].title, '90% from 3 labels');
  assert.equal(f['label-loyalty'].detail, 'Alpha, Beta, Gamma');
  assert.equal(facts([...crate.slice(0, 2), ...filler(8, (i) => rec(`z${i}`, `z${i}`, label(`Label ${i}`)))])['label-loyalty'], undefined, 'spread thin: no loyalty');
}

// ---- wordplay and ranges ------------------------------------------------------------------------------------------------------
{
  const letters = 'ABCDEFGHIJKLMNO'.split('');
  const f = facts(letters.map((l, i) => rec(`${l}rtist`, `t${i}`, { sortArtist: `${l}rtist` })));
  // The A to Z fact is switched off in stats-facts.js for now; its checks run whenever it is on
  if (f['az-coverage']) {
    assert.equal(f['az-coverage'].title, '15 of 26 letters');
    assert.equal(f['az-coverage'].detail, 'No artists under P, Q, R, S and 7 more');
    assert.equal(facts(letters.slice(0, 12).map((l, i) => rec(`${l}rtist`, `t${i}`, { sortArtist: `${l}rtist` })))['az-coverage'], undefined, 'twelve is too few for an alphabet');
    assert.equal(facts('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l, i) => rec(`${l}rtist`, `t${i}`, { sortArtist: `${l}rtist` })))['az-coverage'].detail, 'Every letter has an artist');
  }
}
{
  const crate = [rec('AFI', 'a'), rec('Blur', 'b'), ...filler(8, (i) => rec(`Artist number ${i}`, `t${i}`))];
  assert.equal(facts(crate)['shortest-artist'].title, 'AFI');
  assert.equal(facts(crate)['shortest-artist'].detail, '3 characters');
  assert.equal(facts([rec('AFI', 'a'), rec('XYZ', 'b'), ...crate.slice(2)])['shortest-artist'], undefined, 'a tie for shortest is not a fact');
  assert.equal(facts([rec('Abcdefg', 'a'), ...crate.slice(2)])['shortest-artist'], undefined, 'a long shortest name is not a fact');

  const span = facts([rec('David Bowie', 'Early', { masterYear: 1969 }), rec('David Bowie', 'Late', { masterYear: 1990 }), rec('Short', 'a', { masterYear: 1980 }), rec('Short', 'b', { masterYear: 1985 }), ...crate.slice(2)])['career-span'];
  assert.equal(span.title, 'David Bowie');
  assert.equal(span.detail, '1969–1990 · 21 years across 2 records');
  assert.equal(facts([rec('David Bowie', 'Early', { masterYear: 1969 }), rec('David Bowie', 'Late', { masterYear: 1975 }), ...crate.slice(2)])['career-span'], undefined, 'six years is not a long career');
}
{
  const song = (title) => ({ title, duration: '3:00' });
  const crate = [rec('A', 'Kind of Blue', { tracklist: [song('Blue in Green'), song('Freddie Freeloader')] }), rec('B', 'Blue Monday', { tracklist: [song('Sky is blue')] }),
    rec('C', 'Red', { tracklist: [song('Blue Jay Way')] }), ...filler(8, (i) => rec(`F${i}`, `filler ${i}`, { tracklist: [song(`tune ${i}`)] }))];
  assert.equal(facts(crate)['title-color'].title, 'Blue');
  assert.equal(facts(crate)['title-color'].detail, 'In 5 album and song titles', 'each title counts once');
  assert.equal(facts(crate.slice(3))['title-color'], undefined);
  assert.equal(facts([rec('X', 'Grey Gardens', { tracklist: [song('gray day')] }), ...filler(9, (i) => rec(`F${i}`, `filler ${i}`))])['title-color'], undefined, 'spelling variants of one colour are merged, but two is not enough');

  const ranged = facts(filler(10, (i) => rec(`R${i}`, `r${i}`, { genres: [['Rock', 'Jazz', 'Pop', 'Funk'][i % 4]], styles: [`Style ${i % 5}`] })));
  assert.equal(ranged.range.title, '4 genres');
  assert.equal(ranged.range.detail, 'and 5 styles');
  assert.equal(facts(filler(10, (i) => rec(`R${i}`, `r${i}`, { genres: ['Rock'] }))).range, undefined, 'one genre has no range');
}

// ---- every card the facts can make draws, with the icons they name ---------------------------------------------------------
{
  const icons = new Set();
  const big = [
    ...filler(12, (i) => rec(`Artist ${i}`, `Title ${i}`, { ...pressed(['LP', 'Mono']), sortArtist: `${'ABCDEFGHIJKL'[i]}x`, tracklist: side(['A1', 'B1']), dateAdded: `202${i % 4}-0${1 + (i % 9)}-10T12:00:00Z`, mediaCondition: 'Near Mint (NM or M-)' })),
  ];
  for (const item of computeCollectionFacts(big, { now: NOW })) {
    const html = renderStandoutItem(item);
    assert.ok(html.includes('<li class="st-standout'), `${item.id} draws`);
    assert.ok(!html.includes('undefined'), `${item.id} has no missing text`);
    if (item.icon) icons.add(item.icon);
  }
  for (const icon of icons) assert.ok(renderStandoutItem({ type: 'fact', icon, kicker: 'k', title: 't', detail: 'd' }).includes('<svg'), `${icon} has an icon`);
  for (const icon of ['tag', 'ruler', 'route']) assert.ok(renderStandoutItem({ type: 'fact', icon, kicker: 'k', title: 't', detail: 'd' }).includes('<svg'), `${icon} has an icon`);
}

console.log('Fun facts tests passed.');

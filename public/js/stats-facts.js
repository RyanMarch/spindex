// stats-facts.js - fun facts worked out from what is already inside each record: its Discogs details (labels, credits,
// studios, pressing country), its format and condition, its styles, its dates, its tracklist and its title. Pure
// functions, like stats.js: no network, nothing stored. A fact only appears when there is enough behind it to say
// something, a tie is said out loud rather than hidden, and anything that is an estimate says "about".
import { formatsOf, discCount } from './vinyl.js';
import { groupCredits, creditKinds } from './sync.js';

// How many records must have their details (or credits, tracklists, grades) before a fact built on them is worth
// showing, and how many records the front-runner needs
const MIN_COVERED = 6;
const MIN_LEADER = 3;
const DAY = 86400000;

// ---- shared helpers ---------------------------------------------------------------------------------------------------

const norm = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const key = (person) => (person.id ? `id:${person.id}` : `name:${norm(person.name)}`);
const byTitle = (a, b) => String(a.title).localeCompare(String(b.title));

// "38:12", "1:02:03" -> seconds; anything else -> 0
function seconds(text) {
  const parts = String(text || '').trim().split(':').map((p) => parseInt(p, 10));
  if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) return 0;
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
}

const clock = (total) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
const monthYear = (date) => date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

// Count each thing once per record, remembering which records had it; most common first. keysOf(record) returns
// [{ key, name }], and the name shown is the spelling used most often.
function tallyRecords(records, keysOf) {
  const map = new Map();
  for (const record of records) {
    const seen = new Set();
    for (const item of keysOf(record) || []) {
      if (!item.key || seen.has(item.key)) continue;
      seen.add(item.key);
      const entry = map.get(item.key) || { count: 0, records: [], spellings: new Map() };
      entry.count++;
      entry.records.push(record);
      entry.spellings.set(item.name, (entry.spellings.get(item.name) || 0) + 1);
      map.set(item.key, entry);
    }
  }
  return [...map.values()]
    .map((e) => ({ count: e.count, records: e.records, name: [...e.spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// The front-runner, if it has at least `min` records; `tied` is how many others share its count
function leader(tally, min = MIN_LEADER) {
  const top = tally[0];
  if (!top || top.count < min) return null;
  return { ...top, tied: tally.filter((t) => t.count === top.count).length - 1 };
}

const tiedNote = (tied) => (tied ? ` · tied with ${plural(tied, 'other')}` : '');

// A fact about a person, label or place, shown with a fan of the covers it touches
const fan = (id, kicker, top, detail) => ({ id, type: 'fan', kicker, title: top.name, detail: `${detail}${tiedNote(top.tied || 0)}`, records: top.records.slice(0, 4) });
const fact = (id, icon, kicker, title, detail) => ({ id, type: 'fact', icon, kicker, title, detail });
const about = (id, kicker, record, detail) => ({ id, type: 'record', kicker, record, detail });

// Credits are grouped by what people did (performed, wrote, produced, designed); asked for often, so worked out once
const creditCache = new WeakMap();
const creditGroups = (record) => {
  if (!creditCache.has(record.details)) creditCache.set(record.details, groupCredits(record.details));
  return creditCache.get(record.details);
};
const people = (record, groupTitle) => (creditGroups(record).find((g) => g.title === groupTitle)?.people || []).map((p) => ({ key: key(p), name: p.name }));
const credited = (record, kind) => (record.details.credits || []).filter((c) => creditKinds(c.role).has(kind)).map((c) => ({ key: key(c), name: c.name }));
const companies = (record, role) => (record.details.companies || []).filter((c) => role.test(c.role)).map((c) => ({ key: norm(c.name), name: c.name }));

// Words that describe the pressing: every format's text and descriptions ("12"", "Reissue", "180 Gram", "Mono"...)
const formatWords = (record) => formatsOf(record).flatMap((f) => [f.text, ...(f.descriptions || [])]).filter(Boolean).join(' ');
// A record's years, as the app keeps them: `year` is the one shown in the crate (the original release year, except for
// edition-style titles), `pressingYear` is the year of the pressing you own, and `originalYear` is the app's own call on
// when it first came out (for a "2.0" or "Deluxe" edition, that is the edition itself)
const originalYear = (r) => Number(r.originalYear || r.masterYear || r.year) || 0;
const pressingYear = (r) => Number(r.pressingYear) || Number(String(r.details?.released || '').slice(0, 4)) || 0; // older records: the year Discogs gives the pressing
const isVarious = (artist) => /^various(\s+artists)?$/i.test(String(artist || '').trim());
const ownNames = (r) => new Set([r.artist, ...(r.details?.artists || []).map((a) => a.name)].map(norm));

// "A1" is on side A. Anything else ("1-2", "CD1-3") has no side we can name.
const sideOf = (position) => (String(position || '').trim().match(/^([A-Za-z])\d/) || [])[1]?.toUpperCase() || '';

// Seconds of music on each named side of a record
function sideSeconds(record) {
  const sides = new Map();
  for (const track of record.tracklist || []) {
    const side = sideOf(track.position);
    if (side) sides.set(side, (sides.get(side) || 0) + seconds(track.duration));
  }
  return sides;
}

const discsOf = (record) => discCount(formatsOf(record), [...sideSeconds(record).keys()]);
const sizeOf = (record) => { const words = formatWords(record); return /(^|\s)7"/.test(words) ? 7 : /(^|\s)10"/.test(words) ? 10 : 12; };
const rpmOf = (record) => { const words = formatWords(record); return /\b45\s*(⅓\s*)?rpm/i.test(words) ? 45 : /\b78\s*rpm/i.test(words) ? 78 : 100 / 3; };
const minutesOf = (record) => (record.tracklist || []).reduce((sum, t) => sum + seconds(t.duration), 0) / 60;

// ---- from the Discogs details -----------------------------------------------------------------------------------------

// "Columbia" and "Columbia Records" are one label; self-released records are "Not On Label", which is no label at all
const labelKey = (name) => norm(name).replace(/ (records|recordings)$/, '');

// Discogs dates are "1959-08-17", or only "1959-08" or "1959" when the day isn't known
function nextBirthday(record, today) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(record.details.released || '');
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  let when = Date.UTC(today.getUTCFullYear(), month - 1, day);
  if (when < today.getTime()) when = Date.UTC(today.getUTCFullYear() + 1, month - 1, day);
  return { record, days: Math.round((when - today.getTime()) / DAY), age: new Date(when).getUTCFullYear() - year };
}

const isReissue = (r) => pressingYear(r) > 0 && originalYear(r) > 0 && pressingYear(r) > originalYear(r);

function closestRelatives(records) {
  const byPerson = new Map();
  records.forEach((record, index) => {
    const seen = new Set();
    for (const group of creditGroups(record)) {
      if (group.title === 'Also credited') continue;
      for (const person of group.people) {
        const k = key(person);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!byPerson.has(k)) byPerson.set(k, []);
        byPerson.get(k).push(index);
      }
    }
  });
  const shared = new Map();
  for (const indexes of byPerson.values()) {
    // someone on dozens of records (a mastering engineer) says nothing about any two of them
    if (indexes.length < 2 || indexes.length > 25) continue;
    for (let i = 0; i < indexes.length; i++) {
      for (let j = i + 1; j < indexes.length; j++) {
        if (norm(records[indexes[i]].artist) === norm(records[indexes[j]].artist)) continue; // two by one artist are no surprise
        const pair = `${indexes[i]}|${indexes[j]}`;
        shared.set(pair, (shared.get(pair) || 0) + 1);
      }
    }
  }
  const best = [...shared].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 4) return null;
  const [a, b] = best[0].split('|').map((i) => records[Number(i)]);
  return { a, b, count: best[1] };
}

function factsFromDetails(records, now) {
  const pool = [];
  const detailed = records.filter((r) => r.details);
  const withCredits = detailed.filter((r) => r.details.credits?.length);

  if (detailed.length >= MIN_COVERED) {
    const labels = tallyRecords(detailed, (r) => (r.details.labels || [])
      .filter((l) => !/^not on label|^unknown/i.test(l.name))
      .map((l) => ({ key: labelKey(l.name), name: l.name })));
    const label = leader(labels);
    if (label) pool.push(fan('top-label', 'Most common label', label, plural(label.count, 'record')));

    // How much of the crate a few labels cover, when one of them really does stand out (three labels always cover
    // something, which says nothing about a crate spread across nine)
    if (detailed.length >= 10 && labels.length >= 4 && labels[0].count >= MIN_LEADER) {
      const top = labels.slice(0, 3);
      const covered = new Set(top.flatMap((l) => l.records)).size;
      const pct = Math.round((covered / detailed.length) * 100);
      if (pct >= 40) pool.push(fact('label-loyalty', 'tag', 'Label loyalty', `${pct}% from 3 labels`, top.map((l) => l.name).join(', ')));
    }

    for (const [id, kicker, role, what] of [
      ['top-studio', 'Most common recording studio', /^recorded at$/i, 'recorded here'],
      ['top-mastering', 'Most common mastering studio', /^(re)?mastered at$/i, 'mastered here'],
      ['top-plant', 'Most common pressing plant', /^(pressed|manufactured) by$/i, 'pressed here'],
    ]) {
      const top = leader(tallyRecords(detailed, (r) => companies(r, role)));
      if (top) pool.push(fan(id, kicker, top, `${plural(top.count, 'record')} ${what}`));
    }

    const countries = tallyRecords(detailed, (r) => (r.details.country ? [{ key: norm(r.details.country), name: r.details.country }] : []));
    if (countries.length >= 3) {
      pool.push(fact('countries', 'globe', 'Well travelled', `${countries.length} countries`, `Most pressings from ${countries[0].name} (${countries[0].count})`));
    }

    // A pressing's birthday, when Discogs knows the day it came out; only while it's close enough to be news
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const soon = detailed.map((r) => nextBirthday(r, today)).filter((b) => b && b.days <= 60)
      .sort((a, b) => a.days - b.days || byTitle(a.record, b.record))[0];
    if (soon) {
      const when = soon.days === 0 ? 'today' : soon.days === 1 ? 'tomorrow' : `in ${soon.days} days`;
      pool.push(about('next-birthday', 'Next birthday', soon.record, `${isReissue(soon.record) ? 'Pressing turns' : 'Turns'} ${soon.age} ${when}`));
    }
  }

  if (withCredits.length >= MIN_COVERED) {
    // A musician's own records don't count towards being the most common performer
    const performer = leader(tallyRecords(withCredits, (r) => {
      const own = ownNames(r);
      return people(r, 'Performed by').filter((p) => !own.has(norm(p.name)));
    }));
    if (performer) pool.push(fan('top-performer', 'Most common performer', performer, `Credited on ${plural(performer.count, 'record')}`));

    const producer = leader(tallyRecords(withCredits, (r) => credited(r, 'producer')));
    if (producer) pool.push(fan('top-producer', 'Most common producer', producer, `Produced ${plural(producer.count, 'record')}`));

    const writer = leader(tallyRecords(withCredits, (r) => credited(r, 'writer')));
    if (writer) pool.push(fan('top-writer', 'Most common songwriter', writer, `Wrote on ${plural(writer.count, 'record')}`));

    const cover = leader(tallyRecords(withCredits, (r) => people(r, 'Artwork & photography')));
    if (cover) pool.push(fan('top-cover-credit', 'Cover art regular', cover, `Credited on ${plural(cover.count, 'cover')}`));

    // Records made by their own artist
    const selfMade = withCredits.filter((r) => credited(r, 'producer').some((p) => ownNames(r).has(norm(p.name))));
    if (selfMade.length >= 3) pool.push(fan('self-produced', 'Do it yourself', { name: `${selfMade.length} self-produced`, records: selfMade }, 'Records produced by their own artist'));

    // The one person who played the most different things across your records
    const players = new Map();
    for (const record of withCredits) {
      for (const person of creditGroups(record).find((g) => g.title === 'Performed by')?.people || []) {
        const entry = players.get(key(person)) || { name: person.name, roles: new Set(), records: [] };
        for (const role of person.roles) entry.roles.add(role.toLowerCase().replace(/\s*\(.*?\)/g, '').trim());
        entry.records.push(record);
        players.set(key(person), entry);
      }
    }
    const multi = [...players.values()].sort((a, b) => b.roles.size - a.roles.size || a.name.localeCompare(b.name))[0];
    if (multi && multi.roles.size >= 5) {
      pool.push(fan('multi-instrumentalist', 'Multi-instrumentalist', multi, `${multi.roles.size} different parts across your crate`));
    }

    const relatives = closestRelatives(withCredits);
    if (relatives) {
      pool.push(fan('closest-relatives', 'Closest relatives', { name: `${relatives.a.title} and ${relatives.b.title}`, records: [relatives.a, relatives.b] }, `${relatives.count} people credited on both`));
    }

    // The record with the most people on its sleeve
    const crowded = withCredits
      .map((record) => ({ record, people: new Set(record.details.credits.map(key)).size }))
      .sort((a, b) => b.people - a.people || byTitle(a.record, b.record))[0];
    if (crowded && crowded.people >= 10) pool.push(about('most-credited', 'Most people credited', crowded.record, `${crowded.people} people`));
  }

  return pool;
}

// ---- from the record itself -------------------------------------------------------------------------------------------

const STOP_WORDS = new Set(('the and for you your with from that this are was not but all out has had his her its our who how why what when where there ' +
  'their they them then than into over one two part pt vol feat featuring remastered remaster version mix live demo edit intro outro reprise ' +
  'instrumental interlude bonus track single album').split(' '));

function titleWords(title) {
  const words = String(title || '').toLowerCase().replace(/[’`]/g, "'").split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  return new Set(words);
}

const COLORS = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'black', 'white', 'gold', 'silver', 'grey', 'gray', 'brown']
  .map((name) => ({ name: name === 'gray' ? 'grey' : name, re: new RegExp(`\\b${name}\\b`, 'i') }));

function factsFromRecords(records, now) {
  const pool = [];
  const total = records.length;

  const styled = records.filter((r) => r.styles?.length);
  if (styled.length >= 8) {
    const style = leader(tallyRecords(styled, (r) => r.styles.map((s) => ({ key: norm(s), name: s }))));
    if (style) pool.push(fan('top-style', 'Favorite style', style, plural(style.count, 'record')));
  }

  const genres = new Set(records.flatMap((r) => r.genres || []));
  if (total >= 10 && genres.size >= 4) {
    pool.push(fact('range', 'star', 'Range', `${genres.size} genres`, `and ${plural(new Set(records.flatMap((r) => r.styles || [])).size, 'style')}`));
  }

  const pressed = records.filter((r) => formatsOf(r).length);
  if (pressed.length >= 10) {
    const reissues = pressed.filter((r) => /reissue|repress/i.test(formatWords(r))).length;
    if (reissues >= 2) {
      pool.push(fact('reissue-share', 'repeat', 'Reissues', `${Math.round((reissues / pressed.length) * 100)}% reissues`, `${reissues} of ${pressed.length} are reissues or repressings`));
    }
    const limited = pressed.filter((r) => /limited/i.test(formatWords(r))).length;
    if (limited >= 2) pool.push(fact('limited-editions', 'sparkles', 'Limited editions', plural(limited, 'limited edition'), `${Math.round((limited / pressed.length) * 100)}% of your records`));

    const mono = pressed.filter((r) => /\bmono\b/i.test(formatWords(r))).length;
    if (mono >= 2) pool.push(fact('mono', 'music', 'In mono', plural(mono, 'mono pressing'), `${Math.round((mono / pressed.length) * 100)}% of your records`));

    // The ones that don't fit the usual 12-inch at 33⅓
    const sevens = pressed.filter((r) => sizeOf(r) === 7).length;
    const tens = pressed.filter((r) => sizeOf(r) === 10).length;
    const fast = pressed.filter((r) => sizeOf(r) === 12 && rpmOf(r) === 45).length;
    const odd = [sevens && plural(sevens, 'seven-inch', 'seven-inches'), tens && plural(tens, 'ten-inch', 'ten-inches'), fast && `${fast} at 45 rpm`].filter(Boolean);
    if (sevens + tens + fast >= 2) pool.push(fact('odd-sizes', 'disc', 'Odd ones out', `${sevens + tens + fast} off the usual`, odd.join(' · ')));
  }

  const sets = pressed.map((record) => ({ record, discs: discsOf(record) })).filter((s) => s.discs >= 2);
  if (sets.length >= 2) {
    const biggest = [...sets].sort((a, b) => b.discs - a.discs || byTitle(a.record, b.record))[0];
    pool.push(fact('multi-disc', 'layers', 'More than one disc', plural(sets.length, 'multi-disc set'), `${biggest.discs} discs: ${biggest.record.title}`));
  }

  // Two copies of the same album, in different pressings
  const twins = new Map();
  for (const r of records) {
    const k = r.masterId ? `m:${r.masterId}` : `t:${norm(r.artist)}|${norm(r.title)}`;
    twins.set(k, [...(twins.get(k) || []), r]);
  }
  const doubled = [...twins.values()].filter((g) => g.length >= 2).sort((a, b) => b.length - a.length || byTitle(a[0], b[0]));
  if (doubled.length) {
    const [best] = doubled;
    pool.push(fan('duplicates', 'Owned more than once', { name: best[0].title, records: best }, `${plural(best.length, 'pressing')}${doubled.length > 1 ? ` · ${doubled.length} albums have twins` : ''}`));
  }

  // The widest gap between when a record was first out and the year of the pressing you have
  const gaps = records
    .filter(isReissue)
    .map((record) => ({ record, gap: pressingYear(record) - originalYear(record) }))
    .sort((a, b) => b.gap - a.gap || byTitle(a.record, b.record))[0];
  if (gaps && gaps.gap >= 15) {
    const { record } = gaps;
    pool.push(about('reissue-gap', 'Biggest reissue gap', record, `Pressed ${pressingYear(record)}, first out ${originalYear(record)}`));
  }

  const years = records.map(originalYear).filter((y) => y > 0);
  if (years.length >= 8) {
    const average = Math.round(years.reduce((sum, y) => sum + (now.getFullYear() - y), 0) / years.length);
    pool.push(fact('average-age', 'clock', 'Average age', plural(average, 'year'), 'The average record in your crate'));
  }

  // Artists: the ones who've been at it longest in your crate, the shortest name, and how much of the alphabet you cover
  const artists = tallyRecords(records.filter((r) => !isVarious(r.artist)), (r) => [{ key: norm(r.artist), name: r.artist }]);
  const careers = artists.filter((a) => a.count >= 2).map((a) => {
    const ys = a.records.map(originalYear).filter((y) => y > 0);
    return { ...a, first: Math.min(...ys), last: Math.max(...ys) };
  }).filter((a) => Number.isFinite(a.first) && a.last - a.first >= 15).sort((a, b) => (b.last - b.first) - (a.last - a.first) || b.count - a.count || a.name.localeCompare(b.name))[0];
  if (careers) pool.push(fan('career-span', 'Longest stretch in your crate', careers, `${careers.first}–${careers.last} · ${plural(careers.last - careers.first, 'year')} across ${plural(careers.count, 'record')}`));

  if (total >= 10) {
    const names = artists.map((a) => ({ name: a.name, letters: [...a.name.replace(/[^\p{L}\p{N}]/gu, '')].length })).filter((a) => a.letters > 0).sort((a, b) => a.letters - b.letters || a.name.localeCompare(b.name));
    if (names.length >= 2 && names[0].letters <= 4 && names[0].letters < names[1].letters) {
      pool.push(fact('shortest-artist', 'type', 'Shortest artist name', names[0].name, plural(names[0].letters, 'character')));
    }

    const titled = records.filter((r) => String(r.title || '').trim() && !/^untitled$/i.test(r.title));
    const byLength = [...titled].sort((a, b) => [...b.title].length - [...a.title].length || a.title.localeCompare(b.title));
    const longest = byLength[0];
    if (longest && [...longest.title].length >= 28) pool.push(about('longest-title', 'Longest album title', longest, plural([...longest.title].length, 'character')));
    const shortest = byLength[byLength.length - 1];
    if (shortest && shortest !== longest && [...shortest.title.trim()].length <= 5) pool.push(about('shortest-title', 'Shortest album title', shortest, plural([...shortest.title.trim()].length, 'character')));

    // Records named after a song on them
    const titleTracks = records.filter((r) => (r.tracklist || []).some((t) => norm(t.title) && norm(t.title) === norm(r.title)));
    if (titleTracks.length >= 2) pool.push(fan('title-tracks', 'Named after a song', { name: plural(titleTracks.length, 'title track'), records: titleTracks }, `Like ${titleTracks[0].title}`));

    // A colour that keeps turning up in album and song titles
    const colours = tallyRecords(records.flatMap((r) => [r.title, ...(r.tracklist || []).map((t) => t.title)]).map((title) => ({ title })),
      (entry) => COLORS.filter((c) => c.re.test(entry.title)).map((c) => ({ key: c.name, name: c.name })));
    const colour = leader(colours, 4);
    if (colour) pool.push(fact('title-color', 'sparkles', 'Favorite color', colour.name.charAt(0).toUpperCase() + colour.name.slice(1), `In ${plural(colour.count, 'album and song title')}${tiedNote(colour.tied)}`));
  }

  if (total >= 12) {
    const letter = leader(tallyRecords(records.filter((r) => !isVarious(r.artist)), (r) => {
      const first = String(r.sortArtist || r.artist || '').trim().charAt(0).toUpperCase();
      return [{ key: /[A-Z]/.test(first) ? first : '#', name: /[A-Z]/.test(first) ? first : '#' }];
    }));
    if (letter) pool.push(fact('busiest-letter', 'type', 'Busiest letter', letter.name, `${plural(letter.count, 'record')} from artists under ${letter.name}${tiedNote(letter.tied)}`));
  }

  if (total >= 15) {
    const present = new Set(records.filter((r) => !isVarious(r.artist)).map((r) => String(r.sortArtist || r.artist || '').trim().charAt(0).toUpperCase()).filter((c) => /[A-Z]/.test(c)));
    const missing = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((c) => !present.has(c));
    const shown = missing.slice(0, 4).join(', ');
    pool.push(fact('az-coverage', 'type', 'A to Z', `${present.size} of 26 letters`, missing.length ? `No artists under ${shown}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}` : 'Every letter has an artist'));
  }

  const listed = records.filter((r) => r.tracklist?.length);
  if (listed.length >= 10) {
    const songs = listed.reduce((sum, r) => sum + r.tracklist.length, 0);
    pool.push(fact('total-songs', 'music', 'Songs in your crate', plural(songs, 'song'), `On ${plural(listed.length, 'record')}`));

    // Each song counts once per word, so a title that repeats itself doesn't count twice
    const word = leader(tallyRecords(listed.flatMap((r) => r.tracklist), (track) => [...titleWords(track.title)].map((w) => ({ key: w, name: w }))), 5);
    if (word) pool.push(fact('common-word', 'quote', 'Most repeated word', `“${word.name}”`, `In ${plural(word.count, 'song title')}${tiedNote(word.tied)}`));
  }

  return pool;
}

// ---- the physical world: what the pile weighs, takes up, and asks of a needle --------------------------------------

// A rough weight for one record, sleeve and all: a standard 12-inch disc with its jacket comes to about half a pound,
// a heavyweight disc or a second disc adds to it, a double album's jacket is bigger, and a 7-inch is a fraction.
export function recordPounds(record) {
  const discs = discsOf(record);
  if (!discs) return 0.52; // no format to go on: an ordinary LP
  const size = sizeOf(record);
  const heavy = /180\s*g|200\s*g|heavyweight/i.test(formatWords(record));
  const disc = size === 7 ? 0.1 : size === 10 ? 0.18 : heavy ? 0.4 : 0.26;
  const jacket = size === 7 ? 0.04 : size === 10 ? 0.12 : discs >= 2 ? 0.4 : 0.24;
  return discs * (disc + 0.02) + jacket;
}

export const estimatedPounds = (records) => records.reduce((sum, r) => sum + recordPounds(r), 0);

// Shelf room for one record, in inches: a jacket is a little over an inch to the half-dozen, and each extra disc thickens it
const shelfInches = (record) => { const size = sizeOf(record); return size === 7 ? 0.08 : size === 10 ? 0.13 : 0.17 + 0.13 * Math.max(0, (discsOf(record) || 1) - 1); };

// About how much groove a minute of music takes: a 12-inch side of about 22 minutes carries roughly half a kilometre
const METRES_PER_MINUTE = 23;

function factsFromTheWorld(records) {
  const pool = [];

  // Shelf room needs only the format, so it doesn't wait for tracklists
  const inches = records.reduce((sum, r) => sum + shelfInches(r), 0);
  if (records.length >= 10 && inches >= 12) {
    const whole = Math.round(inches); // round first, so 23.6 inches is 2 ft and not "1 ft 12 in"
    const feet = Math.floor(whole / 12);
    const rest = whole % 12;
    pool.push(fact('shelf-space', 'ruler', 'Shelf space', `About ${feet} ft${rest ? ` ${rest} in` : ''}`, 'For the whole crate, standing up'));
  }

  const listed = records.filter((r) => r.tracklist?.length);
  if (listed.length < 10) return pool;

  // Sides: read from the track positions, or two to a disc when the positions don't say
  const sides = listed.map((r) => sideSeconds(r).size || (discsOf(r) ? discsOf(r) * 2 : 0));
  const flips = sides.reduce((sum, n) => sum + n, 0);
  if (flips > 0) pool.push(fact('flips', 'repeat', 'Start to finish', `${plural(flips, 'side')} to play`, 'Record flips to hear everything'));

  const minutes = listed.reduce((sum, r) => sum + minutesOf(r), 0);
  const metres = listed.reduce((sum, r) => sum + minutesOf(r) * METRES_PER_MINUTE * (rpmOf(r) / (100 / 3)), 0);
  const miles = metres / 1609.34;
  if (minutes >= 60 && miles >= 1) {
    const spins = listed.reduce((sum, r) => sum + minutesOf(r) * rpmOf(r), 0);
    const roundedSpins = Math.round(spins / 100) * 100;
    pool.push(fact('needle-mileage', 'route', 'Needle mileage', `About ${miles >= 10 ? Math.round(miles) : miles.toFixed(1)} miles`, `Of groove, spun about ${roundedSpins.toLocaleString('en-US')} times`));
  }

  // The fullest single side of vinyl
  let fullest = null;
  for (const record of listed) {
    for (const [side, secs] of sideSeconds(record)) {
      if (!fullest || secs > fullest.secs || (secs === fullest.secs && byTitle(record, fullest.record) < 0)) fullest = { record, side, secs };
    }
  }
  if (fullest && fullest.secs >= 20 * 60) pool.push(about('longest-side', 'Longest side of vinyl', fullest.record, `Side ${fullest.side} · ${clock(fullest.secs)}`));

  return pool;
}

// ---- when records came into the crate ---------------------------------------------------------------------------------

function factsFromDates(records, now) {
  const pool = [];
  const dated = records.map((record) => ({ record, at: new Date(record.dateAdded) })).filter((d) => !Number.isNaN(d.at.getTime())).sort((a, b) => a.at - b.at);
  if (dated.length < 10) return pool;

  const months = tallyRecords(dated.map((d) => d.record), (record) => {
    const at = new Date(record.dateAdded);
    return [{ key: `${at.getUTCFullYear()}-${at.getUTCMonth()}`, name: monthYear(at) }];
  });
  const month = leader(months, 4);
  if (month) pool.push(fact('busiest-month', 'calendar', 'Busiest month', month.name, `${plural(month.count, 'record')} added${tiedNote(month.tied)}`));

  let gap = null;
  for (let i = 1; i < dated.length; i++) {
    const days = (dated[i].at - dated[i - 1].at) / DAY;
    if (!gap || days > gap.days) gap = { days, from: dated[i - 1].at, to: dated[i].at };
  }
  if (gap && gap.days >= 60) pool.push(fact('dry-spell', 'clock', 'Longest dry spell', plural(Math.round(gap.days / 30.4), 'month'), `Nothing added, ${monthYear(gap.from)} to ${monthYear(gap.to)}`));

  const span = (dated[dated.length - 1].at - dated[0].at) / DAY;
  if (span >= 365) {
    const years = Math.max(1, Math.round((now - dated[0].at) / (365.25 * DAY)));
    pool.push(fact('collecting-since', 'calendar', 'Collecting since', monthYear(dated[0].at), `${plural(years, 'year')} and ${plural(dated.length, 'record')} on`));
  }
  if (span >= 60) {
    const every = span / (dated.length - 1);
    pool.push(fact('pace', 'repeat', 'Pace', every < 1.5 ? 'Nearly every day' : `Every ${Math.round(every)} days`, 'A new record, on average'));
  }

  return pool;
}

// ---- condition: the grades you gave them -----------------------------------------------------------------------------

// Discogs' grading scale, best to worst; anything else ("Generic", "Not Graded") has no grade
function grade(text) {
  const t = String(text || '').toLowerCase();
  if (t.startsWith('near mint') || t.includes('(nm')) return 7;
  if (t.startsWith('mint')) return 8;
  if (t.startsWith('very good plus') || t.includes('(vg+)')) return 6;
  if (t.startsWith('very good') || t.includes('(vg)')) return 5;
  if (t.startsWith('good plus') || t.includes('(g+)')) return 4;
  if (t.startsWith('good') || t.includes('(g)')) return 3;
  if (t.startsWith('fair')) return 2;
  if (t.startsWith('poor')) return 1;
  return 0;
}

function factsFromCondition(records) {
  const pool = [];
  const graded = records.filter((r) => grade(r.mediaCondition) > 0);
  if (graded.length < MIN_COVERED) return pool;

  const near = graded.filter((r) => grade(r.mediaCondition) >= 7).length;
  if (near > 0) pool.push(fact('condition-nm', 'star', 'Condition', `${Math.round((near / graded.length) * 100)}% Near Mint or better`, `${near} of ${graded.length} graded records`));

  const both = graded.filter((r) => grade(r.sleeveCondition) > 0);
  if (both.length >= MIN_COVERED) {
    const rougher = both.filter((r) => grade(r.sleeveCondition) < grade(r.mediaCondition)).length;
    const better = both.filter((r) => grade(r.sleeveCondition) > grade(r.mediaCondition)).length;
    if (rougher >= 2) pool.push(fact('sleeve-worse', 'layers', 'Sleeve vs. disc', plural(rougher, 'rougher sleeve'), 'Jacket in worse shape than the disc'));
    if (better >= 2) pool.push(fact('sleeve-better', 'layers', 'Sleeve vs. disc', plural(better, 'better sleeve'), 'Jacket in better shape than the disc'));
  }

  const roughest = [...graded].sort((a, b) => grade(a.mediaCondition) - grade(b.mediaCondition) || byTitle(a, b))[0];
  if (roughest && grade(roughest.mediaCondition) <= 5) pool.push(about('roughest-record', 'Roughest record', roughest, roughest.mediaCondition));

  return pool;
}

export function computeCollectionFacts(records, { now = new Date() } = {}) {
  const list = (records || []).filter(Boolean);
  return [
    ...factsFromDetails(list, now),
    ...factsFromRecords(list, now),
    ...factsFromTheWorld(list),
    ...factsFromDates(list, now),
    ...factsFromCondition(list),
  ];
}

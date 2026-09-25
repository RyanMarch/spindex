// stats.js - numbers about the whole collection, worked out from the records already in this browser. Pure functions:
// no network and nothing stored, so they are easy to test.
import { parseVinyl, formatsOf } from './vinyl.js';
import { sortYear } from './years.js';
import { getGenreTags } from './sync.js';

const isMock = (r) => String(r.id).startsWith('discogs_mock_');
const isVarious = (artist) => /^various(\s+artists)?$/i.test(String(artist || '').trim());

// "38:12", "1:02:03" -> seconds; anything else -> 0
export function durationSeconds(text) {
  const parts = String(text || '').trim().split(':').map((p) => parseInt(p, 10));
  if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) return 0;
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
}

const tally = (items) => {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

// How the pressing looks, in the groups a collector talks about
export function colorGroup(vinyl) {
  switch (vinyl.kind) {
    case 'black': return 'Black';
    case 'translucent': return 'Clear';
    case 'solid': return 'Coloured';
    case 'marble': return 'Marbled';
    case 'splatter': return 'Splatter';
    case 'swirl': return 'Swirl';
    case 'split': return 'Split';
    case 'picture': return 'Picture disc';
    default: return 'Black';
  }
}

const monthKey = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function computeStats(records, { topGenres = 7, topArtists = 8 } = {}) {
  const list = (records || []).filter((r) => !isMock(r));
  const real = list.length > 0 ? list : records || [];
  const total = real.length;

  // Release years, by decade
  const dated = real.map((r) => ({ record: r, year: sortYear(r) })).filter((x) => x.year > 0);
  const decadeCounts = new Map();
  for (const { year } of dated) {
    const decade = Math.floor(year / 10) * 10;
    decadeCounts.set(decade, (decadeCounts.get(decade) || 0) + 1);
  }
  const decades = [...decadeCounts].sort((a, b) => a[0] - b[0]).map(([decade, count]) => ({
    name: `${decade}s`,
    decade,
    count,
    years: dated.filter((x) => Math.floor(x.year / 10) * 10 === decade).map((x) => x.year).sort((a, b) => a - b),
  }));
  const byYear = [...dated].sort((a, b) => a.year - b.year);
  const oldest = byYear[0] || null;
  const newest = byYear[byYear.length - 1] || null;

  // Genres: each record files under its primary tag, so the bars add up to the collection
  const genreTally = tally(real.map((r) => getGenreTags(r)[0] || 'Unfiled'));
  const genres = genreTally.slice(0, topGenres);
  const otherCount = genreTally.slice(topGenres).reduce((sum, g) => sum + g.count, 0);
  if (otherCount > 0) genres.push({ name: 'Everything else', count: otherCount });

  // Artists
  const artistNames = real.map((r) => r.artist).filter((a) => a && !isVarious(a));
  const artistTally = tally(artistNames);

  // The artist with the most records, and a few of their sleeves to show
  const topName = artistTally[0]?.count > 1 ? artistTally[0] : null;
  const topArtist = topName ? { ...topName, records: real.filter((r) => r.artist === topName.name).slice(0, 4) } : null;

  // Pressings: colour needs the full Discogs details, which fill in gradually
  const withDetails = real.filter((r) => formatsOf(r).length);
  const colorMap = new Map();
  for (const record of withDetails) {
    const vinyl = parseVinyl(formatsOf(record));
    const name = colorGroup(vinyl);
    const entry = colorMap.get(name) || { name, count: 0, sample: vinyl };
    entry.count++;
    colorMap.set(name, entry);
  }
  const colors = [...colorMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Runtime, and the record that takes longest to play
  const lengths = real.map((r) => ({ record: r, seconds: (r.tracklist || []).reduce((sum, t) => sum + durationSeconds(t.duration), 0) }));
  const runtimeSeconds = lengths.reduce((sum, x) => sum + x.seconds, 0);
  const longest = lengths.filter((x) => x.seconds > 0).sort((a, b) => b.seconds - a.seconds)[0] || null;

  // Growth: how the collection built up, by month added
  const monthCounts = new Map();
  for (const r of real) {
    const key = monthKey(r.dateAdded);
    if (key) monthCounts.set(key, (monthCounts.get(key) || 0) + 1);
  }
  let running = 0;
  const growth = [...monthCounts].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, added: count, total: (running += count) }));

  return {
    total,
    artistCount: artistTally.length,
    topArtists: artistTally.slice(0, topArtists),
    decades,
    undated: total - dated.length,
    oldest,
    newest,
    longest,
    topArtist,
    genres,
    colors,
    colorCoverage: { known: withDetails.length, total },
    runtimeSeconds,
    growth,
    firstAdded: growth[0]?.month || null,
    standoutsPool: buildStandoutsPool({
      oldest,
      newest,
      longest,
      topArtist,
      records: real,
      dated,
      lengths,
      runtimeSeconds,
    }),
  };
}

// Build a unified pool of standout and curiosity items for the Standouts section
export function buildStandoutsPool({
  oldest = null,
  newest = null,
  longest = null,
  topArtist = null,
  records = [],
  dated = [],
  lengths = [],
  runtimeSeconds = 0,
} = {}) {
  const pool = [];

  // Core anchor standouts
  if (oldest) {
    pool.push({
      id: 'oldest-release',
      type: 'record',
      kicker: 'Oldest Release',
      record: oldest.record,
      detail: `${oldest.year}`,
    });
  }
  if (newest && newest.record !== oldest?.record) {
    pool.push({
      id: 'newest-release',
      type: 'record',
      kicker: 'Newest Release',
      record: newest.record,
      detail: `${newest.year}`,
    });
  }
  if (longest) {
    const minutes = Math.round(longest.seconds / 60);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    const durStr = minutes < 60 ? `${minutes} min` : (rest ? `${hours} hr ${rest} min` : `${hours} hr`);
    pool.push({
      id: 'longest-album',
      type: 'record',
      kicker: 'Longest Album',
      record: longest.record,
      detail: durStr,
    });
  }
  if (topArtist) {
    pool.push({
      id: 'top-artist',
      type: 'artist-fan',
      kicker: 'Most collected',
      artist: topArtist.name,
      records: topArtist.records,
      count: topArtist.count,
    });
  }

  // Fun curiosity stats
  const fun = computeFunStats(records, { dated, lengths, runtimeSeconds });
  pool.push(...fun);

  return pool;
}

// Fun stats pool: evaluated purely in-memory from loaded records.
export function computeFunStats(records, { dated = [], lengths = [], runtimeSeconds = 0 } = {}) {
  const pool = [];
  if (!records || records.length === 0) return pool;

  // 1. Earliest added record to collection
  const withDateAdded = records
    .filter((r) => r.dateAdded && !Number.isNaN(new Date(r.dateAdded).getTime()))
    .sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded));

  if (withDateAdded.length > 0) {
    const earliest = withDateAdded[0];
    const dateStr = new Date(earliest.dateAdded).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
    pool.push({
      id: 'first-added',
      type: 'record',
      kicker: 'First logged addition',
      record: earliest,
      detail: dateStr,
    });

    // 2. Latest added record (if distinct from earliest and at least 3 records)
    if (withDateAdded.length >= 3) {
      const latest = withDateAdded[withDateAdded.length - 1];
      if (latest !== earliest) {
        const latestDateStr = new Date(latest.dateAdded).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        });
        pool.push({
          id: 'latest-added',
          type: 'record',
          kicker: 'Latest addition',
          record: latest,
          detail: latestDateStr,
        });
      }
    }
  }

  // 3. Biggest haul day (single calendar day with the most records added, if >= 2)
  if (withDateAdded.length >= 4) {
    const dayCounts = new Map();
    for (const r of withDateAdded) {
      const d = r.dateAdded.slice(0, 10);
      dayCounts.set(d, (dayCounts.get(d) || 0) + 1);
    }
    const sortedDays = [...dayCounts.entries()].sort((a, b) => b[1] - a[1]);
    if (sortedDays.length > 0 && sortedDays[0][1] >= 2) {
      const [topDay, count] = sortedDays[0];
      const [y, m, d] = topDay.split('-').map(Number);
      const formatted = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
      pool.push({
        id: 'biggest-haul-day',
        type: 'fact',
        icon: 'calendar',
        kicker: 'Biggest haul in one day',
        title: `${count} records added`,
        detail: formatted,
      });
    }
  }

  // 4. Primary cataloging day of the week
  if (withDateAdded.length >= 10) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekdayCounts = new Array(7).fill(0);
    for (const r of withDateAdded) {
      weekdayCounts[new Date(r.dateAdded).getUTCDay()]++;
    }
    const maxDayCount = Math.max(...weekdayCounts);
    const topDayIdx = weekdayCounts.indexOf(maxDayCount);
    const pct = Math.round((maxDayCount / withDateAdded.length) * 100);
    if (pct >= 25) {
      pool.push({
        id: 'favorite-add-day',
        type: 'fact',
        icon: 'clock',
        kicker: 'Cataloging habit',
        title: `${dayNames[topDayIdx]}s`,
        detail: `${pct}% of records cataloged`,
      });
    }
  }

  // 5. Shortest album (minimum 3 tracks, over 10 min runtime)
  const validLengths = (lengths.length > 0 ? lengths : records.map((r) => ({
    record: r,
    seconds: (r.tracklist || []).reduce((sum, t) => sum + durationSeconds(t.duration), 0),
  }))).filter((x) => x.seconds >= 600 && (x.record.tracklist || []).length >= 3);

  if (validLengths.length >= 2) {
    const shortest = [...validLengths].sort((a, b) => a.seconds - b.seconds)[0];
    if (shortest) {
      const mins = Math.round(shortest.seconds / 60);
      pool.push({
        id: 'shortest-album',
        type: 'record',
        kicker: 'Quickest spin',
        record: shortest.record,
        detail: `${mins} min runtime`,
      });
    }
  }

  // 6. Album with the most tracks (if >= 14 tracks)
  const withTracklists = records.filter((r) => Array.isArray(r.tracklist) && r.tracklist.length >= 14);
  if (withTracklists.length > 0) {
    const mostTracks = [...withTracklists].sort((a, b) => b.tracklist.length - a.tracklist.length)[0];
    pool.push({
      id: 'most-tracks',
      type: 'record',
      kicker: 'Most tracks on one record',
      record: mostTracks,
      detail: `${mostTracks.tracklist.length} tracks`,
    });
  }

  // 7. Longest single track (if >= 10 minutes)
  let longestTrack = null;
  for (const r of records) {
    for (const t of r.tracklist || []) {
      const sec = durationSeconds(t.duration);
      if (sec >= 600 && (!longestTrack || sec > longestTrack.sec)) {
        longestTrack = { record: r, track: t.title || 'Untitled', sec, duration: t.duration };
      }
    }
  }
  if (longestTrack) {
    pool.push({
      id: 'longest-track',
      type: 'record',
      kicker: 'Longest single track',
      record: longestTrack.record,
      detail: `“${longestTrack.track}” · ${longestTrack.duration}`,
    });
  }

  // 8. Self-titled releases (artist matches title)
  const selfTitled = records.filter((r) => {
    if (!r.title || !r.artist || isVarious(r.artist)) return false;
    const a = r.artist.trim().toLowerCase().replace(/^the\s+/, '');
    const t = r.title.trim().toLowerCase().replace(/^the\s+/, '');
    return a === t;
  });
  if (selfTitled.length >= 2) {
    pool.push({
      id: 'self-titled-count',
      type: 'fact',
      icon: 'sparkles',
      kicker: 'Self-titled releases',
      title: `${selfTitled.length} albums`,
      detail: 'Matching artist & album title',
    });
  }

  // 9. Single-record artists ("one-and-done" crate presence)
  const artistCounts = new Map();
  for (const r of records) {
    if (r.artist && !isVarious(r.artist)) {
      artistCounts.set(r.artist, (artistCounts.get(r.artist) || 0) + 1);
    }
  }
  let soloArtists = 0;
  for (const count of artistCounts.values()) {
    if (count === 1) soloArtists++;
  }
  if (artistCounts.size >= 8 && soloArtists >= 4) {
    const pct = Math.round((soloArtists / artistCounts.size) * 100);
    pool.push({
      id: 'one-album-artists',
      type: 'fact',
      icon: 'disc',
      kicker: 'Solo discoveries',
      title: `${soloArtists} single-record artists`,
      detail: `${pct}% of artists in your crate`,
    });
  }

  // 10. Golden release year (peak year by release count)
  if (dated.length >= 8) {
    const yearCounts = new Map();
    for (const { year } of dated) {
      yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
    }
    const sortedYears = [...yearCounts.entries()].sort((a, b) => b[1] - a[1]);
    if (sortedYears.length > 0 && sortedYears[0][1] >= 3) {
      pool.push({
        id: 'golden-year',
        type: 'fact',
        icon: 'star',
        kicker: 'Favorite release year',
        title: `${sortedYears[0][0]}`,
        detail: `${sortedYears[0][1]} records released that year`,
      });
    }
  }

  // 11. Estimated physical weight of the collection
  if (records.length >= 10) {
    const approxLbs = Math.round(records.length * 0.52);
    pool.push({
      id: 'collection-weight',
      type: 'fact',
      icon: 'scale',
      kicker: 'Estimated weight',
      title: `~${approxLbs} lbs`,
      detail: `~${Math.round(approxLbs * 0.453592)} kg of vinyl`,
    });
  }

  return pool;
}

// stats.js - numbers about the whole collection, worked out from the records already in this browser. Pure functions:
// no network and nothing stored, so they are easy to test.
import { parseVinyl } from './vinyl.js';
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
  const withDetails = real.filter((r) => r.details?.formats?.length);
  const colorMap = new Map();
  for (const record of withDetails) {
    const vinyl = parseVinyl(record.details.formats);
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
  };
}

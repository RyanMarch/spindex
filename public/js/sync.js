// sync.js - Discogs syncing and iTunes art enrichment
import { upsertRecords, updateRecord, getAllRecords, deleteRecords } from './db.js';
import { discogsFetch } from './discogs.js';
import { createLimiter } from './limiter.js';
import { needsFullSync, canStopEarly, readSyncMeta, writeSyncMeta, removedRecordIds } from './syncplan.js';
import { masterYearUpdates, itunesYearUpdates, isEditionTitle } from './years.js';

// Apple allows roughly 20 iTunes searches a minute per address, and when it says no, it leaves out the CORS header, so
// the browser reports a rejected request rather than a 429. Everything goes through one paced queue, and a rejection
// pauses it and retries instead of ending the whole pass.
const itunesLimiter = createLimiter({ pace: () => 3200, maxRetries: 2 });

function itunesFetch(url, priority = 'low') {
  return itunesLimiter.schedule(async () => {
    try {
      return await fetch(url);
    } catch {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
      return { status: 429, ok: false, headers: { get: () => null } };
    }
  }, priority);
}

// Known band names or entities that shouldn't be split into "Last, First"
const KNOWN_BANDS = new Set([
  'fleetwood mac',
  'daft punk',
  'talking heads',
  'aphex twin',
  'radiohead',
  'portishead',
  'yellowcard',
  'pink floyd',
  'led zeppelin',
  'deep purple',
  'black sabbath',
  'iron maiden',
  'judas priest',
  'motorhead',
  'motörhead',
  'pearl jam',
  'soundgarden',
  'alice in chains',
  'stone temple pilots',
  'smashing pumpkins',
  'red hot chili peppers',
  'foo fighters',
  'green day',
  'blink-182',
  'weezer',
  'depeche mode',
  'new order',
  'joy division',
  'massive attack',
  'boards of canada',
  'chemical brothers',
  'gorillaz',
  'arcade fire',
  'tame impala',
  'vampire weekend',
  'modest mouse',
  'death cab for cutie',
  'sonic youth',
  'pixies',
  'kraftwerk',
  'tangerine dream',
  'velvet underground',
  'beach boys',
  'kinks',
  'who',
  'doors',
  'rolling stones',
  'grateful dead',
  'genesis',
  'yes',
  'rush',
  'police',
  'clash',
  'smiths',
  'cure',
  'oasis',
  'blur',
  'pulp',
  'strokes',
  'white stripes',
  'arctic monkeys',
  'cocteau twins',
  'slowdive',
  'my bloody valentine',
  'fugazi',
  'bad brains',
  'dead kennedys',
  'ramones',
  'misfits',
  'blondie',
  'steely dan',
  'wu-tang clan',
  'a tribe called quest',
  'outkast',
  'public enemy',
  'beastie boys',
  'run-dmc',
  'cypress hill',
  'gang starr',
  'fugees',
  'roots',
  'minus the bear',
  'jimmy eat world',
  'men at work',
  'american war',
  'american football',
  'beach house',
  'animal collective',
  'grizzly bear',
  'fleet foxes',
  'bright eyes',
  'brand new',
  'real estate',
  'built to spill',
  'broken social scene',
  'broken bells',
  'modern english',
  'simple minds',
  'tears for fears',
  'neutral milk hotel',
  'guided by voices',
  'sunny day real estate',
  'saves the day',
  'circa survive',
  'manchester orchestra',
  'tokyo police club',
  'british sea power',
  'russian circles',
  'japanese breakfast',
  'taking back sunday',
  'coheed and cambria',
  'thrice',
  'thursday',
  'the the',
]);

// Connecting words that indicate a phrase/band rather than a person middle name
const BAND_CONNECTORS = new Set([
  'the', 'for', 'of', 'and', 'a', 'an', 'to', 'in', 'on', 'at', 'by', 'from',
  'with', 'without', 'vs', 'versus', 'meets', 'against', 'under', 'over', 'into',
  'eat', 'eats', 'play', 'plays', 'like', 'likes', 'love', 'loves', 'hate', 'hates',
  'kill', 'kills', 'save', 'saves', 'run', 'runs', 'walk', 'walks', 'talk', 'talks',
]);

// Initial words that strongly signify bands/projects rather than personal first names
const BAND_START_WORDS = new Set([
  'american', 'british', 'japanese', 'french', 'german', 'irish', 'scottish', 'russian',
  'canadian', 'italian', 'spanish', 'australian', 'modern', 'simple', 'cold', 'black',
  'white', 'pink', 'deep', 'red', 'green', 'blue', 'bad', 'dead', 'holy', 'dark',
  'bright', 'sweet', 'wild', 'little', 'big', 'new', 'young', 'raw', 'pure', 'silent',
  'velvet', 'sonic', 'electric', 'atomic', 'cosmic', 'minus', 'tame', 'arcade',
  'vampire', 'modest', 'death', 'iron', 'pearl', 'stone', 'smashing', 'beach', 'rolling',
  'grateful', 'cage', 'tokyo', 'men', 'women', 'boy', 'boys', 'girl', 'girls', 'kids',
  'brothers', 'sisters', 'band', 'orchestra', 'trio', 'quartet', 'quintet', 'collective',
  'ensemble', 'project', 'sound', 'sounds', 'system', 'choir', 'society', 'club',
  'syndicate', 'all-stars', 'all stars', 'dirty', 'heavy', 'royal', 'national', 'public',
  'war',
]);

// Common personal given names to distinguish solo artists from multi-word band names
const COMMON_FIRST_NAMES = new Set([
  'aaron', 'abigail', 'adam', 'adele', 'adrian', 'alan', 'albert', 'alec', 'alex', 'alexa',
  'alexander', 'alexis', 'alice', 'alicia', 'alison', 'alyssa', 'amanda', 'amber', 'amy',
  'andre', 'andrew', 'andy', 'angela', 'ann', 'anna', 'anne', 'anthony', 'antonio', 'aretha',
  'arthur', 'ashley', 'barry', 'ben', 'benjamin', 'beth', 'betty', 'bill', 'billie', 'billy',
  'bjork', 'björk', 'bob', 'bobby', 'bonnie', 'brad', 'brandon', 'brenda', 'brian', 'brittany',
  'bruce', 'bryan', 'cameron', 'carl', 'carlos', 'carly', 'carol', 'carole', 'caroline', 'carter',
  'casey', 'cat', 'catherine', 'cathy', 'chad', 'charles', 'charlie', 'chelsea', 'chloe', 'chris',
  'christian', 'christina', 'christine', 'christopher', 'clara', 'clare', 'clark', 'cody', 'colin',
  'connor', 'courtney', 'craig', 'curtis', 'dan', 'dana', 'daniel', 'danielle', 'danny', 'dave',
  'david', 'dean', 'debbie', 'deborah', 'dennis', 'derek', 'diana', 'diane', 'donald', 'donna',
  'doug', 'douglas', 'dustin', 'dylan', 'earl', 'eddie', 'edgar', 'edward', 'eleanor', 'eli',
  'elijah', 'elisabeth', 'elizabeth', 'ella', 'ellen', 'ellie', 'elliott', 'elton', 'elvis', 'emily',
  'emma', 'eric', 'erik', 'erykah', 'ethan', 'eva', 'evan', 'evelyn', 'fiona', 'frank',
  'franklin', 'fred', 'freddie', 'gabriel', 'garrett', 'garth', 'gary', 'geoffrey', 'george',
  'georgia', 'gerald', 'glen', 'glenn', 'gordon', 'grace', 'grant', 'greg', 'gregory', 'hank',
  'hannah', 'harold', 'harry', 'harvey', 'hayley', 'heather', 'helen', 'henry', 'howard', 'hugh',
  'ian', 'isaac', 'isabel', 'jack', 'jackson', 'jacob', 'jacqueline', 'james', 'jamie', 'jane',
  'janet', 'janice', 'janis', 'jared', 'jason', 'jay', 'jean', 'jeff', 'jeffrey', 'jennifer',
  'jenny', 'jeremy', 'jerry', 'jesse', 'jessica', 'jessie', 'jimi', 'jimmy', 'joan', 'joanna',
  'joe', 'joel', 'john', 'johnny', 'jon', 'jonathan', 'joni', 'jordan', 'joseph', 'josh',
  'joshua', 'joy', 'joyce', 'judith', 'judy', 'julia', 'julian', 'julie', 'julien', 'justin',
  'kacey', 'karen', 'karl', 'kate', 'katherine', 'kathleen', 'kathy', 'katie', 'keith', 'kelly',
  'ken', 'kenneth', 'kenny', 'kevin', 'kim', 'kimberly', 'kirk', 'kurt', 'kyle', 'lana',
  'larry', 'laura', 'lauren', 'laurie', 'lawrence', 'lee', 'leo', 'leon', 'leonard', 'leslie',
  'lewis', 'liam', 'linda', 'lindsay', 'lisa', 'liz', 'lizzie', 'logan', 'lori', 'lou',
  'louis', 'lucas', 'lucy', 'luke', 'lynn', 'mac', 'maggie', 'malcolm', 'marc', 'marcus',
  'margaret', 'maria', 'marian', 'marie', 'marilyn', 'mark', 'marsha', 'marshall', 'martha',
  'martin', 'marvin', 'mary', 'mason', 'matt', 'matthew', 'maurice', 'max', 'megan', 'melanie',
  'melissa', 'michael', 'michelle', 'mike', 'miles', 'miranda', 'mitchell', 'molly', 'morgan',
  'morris', 'nancy', 'natalie', 'nathan', 'neil', 'nicholas', 'nick', 'nicole', 'nina', 'noah',
  'nora', 'norman', 'oliver', 'olivia', 'otis', 'owen', 'pamela', 'patricia', 'patrick', 'paul',
  'paula', 'peggy', 'penny', 'pete', 'peter', 'phil', 'philip', 'phillip', 'phoebe', 'rachel',
  'ralph', 'randy', 'ray', 'raymond', 'rebecca', 'regina', 'rex', 'rhonda', 'richard', 'rick',
  'ricky', 'rita', 'rob', 'robbie', 'robert', 'robin', 'roger', 'roland', 'ron', 'ronald',
  'ronnie', 'rose', 'ross', 'roy', 'russell', 'ruth', 'ryan', 'sam', 'samantha', 'samia',
  'samuel', 'sandra', 'sara', 'sarah', 'scott', 'sean', 'seth', 'sharon', 'shawn', 'sheila',
  'shirley', 'simon', 'stan', 'stanley', 'stefan', 'stephanie', 'stephen', 'steve', 'steven',
  'stevie', 'stewart', 'stuart', 'sue', 'sufjan', 'susan', 'susanne', 'suzanne', 'sydney',
  'sylvia', 'taylor', 'ted', 'teddy', 'teresa', 'terry', 'theodore', 'theresa', 'thomas',
  'tim', 'timothy', 'tina', 'todd', 'tom', 'tommy', 'tony', 'tracey', 'tracy', 'travis',
  'trevor', 'tyler', 'valerie', 'vanessa', 'vernon', 'victor', 'victoria', 'vincent', 'virginia',
  'walter', 'warren', 'wayne', 'wendy', 'wesley', 'whitney', 'will', 'william', 'willie',
  'zach', 'zachary'
]);

export function parseSortArtist(rawArtist = '') {
  // Strip trailing discogs numeric disambiguations, such as "Duran Duran (2)" -> "Duran Duran"
  let cleaned = rawArtist.replace(/\s\(\d+\)$/, '').trim();
  if (!cleaned) return '';

  // Handle leading English articles
  if (/^the\s+/i.test(cleaned)) {
    return `${cleaned.slice(4).trim()}, The`;
  }
  if (/^a\s+/i.test(cleaned)) {
    return `${cleaned.slice(2).trim()}, A`;
  }
  if (/^an\s+/i.test(cleaned)) {
    return `${cleaned.slice(3).trim()}, An`;
  }

  // If already formatted as "Last, First", keep it
  if (cleaned.includes(',')) {
    return cleaned;
  }

  const lower = cleaned.toLowerCase();
  if (KNOWN_BANDS.has(lower)) {
    return cleaned;
  }

  // Handle collaboration joiners / multi-artist strings
  if (/\s(?:&|and|feat\.?|featuring|vs\.?|x)\s/i.test(cleaned)) {
    return cleaned;
  }

  const parts = cleaned.split(/\s+/);

  // Single word names (e.g. Sade, Prince, Madonna, Cher, Yellowcard)
  if (parts.length <= 1) {
    return cleaned;
  }

  const firstLower = parts[0].toLowerCase();

  // If the initial word is a known band descriptor/adjective, keep natural order
  if (BAND_START_WORDS.has(firstLower)) {
    return cleaned;
  }

  // Band names containing internal articles, prepositions, or phrase verbs
  if (parts.slice(1, -1).some((p) => BAND_CONNECTORS.has(p.toLowerCase()))) {
    return cleaned;
  }

  // Names with 4 or more words are almost always bands or ensembles
  if (parts.length > 3) {
    return cleaned;
  }

  // Repeated words (e.g. Duran Duran, Talk Talk)
  if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
    return cleaned;
  }

  // Surnames with generational suffixes (Jr., Sr., III, etc.)
  const suffixes = ['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv'];
  const lastPart = parts[parts.length - 1].toLowerCase();
  if (suffixes.includes(lastPart) && parts.length >= 3) {
    if (COMMON_FIRST_NAMES.has(firstLower)) {
      const suffix = parts.pop();
      const lastName = parts.pop();
      return `${lastName}, ${parts.join(' ')} ${suffix}`;
    }
    return cleaned;
  }

  // For 2-word and 3-word names, only invert if the first token is a recognized given name
  // and the remaining tokens do not indicate band nouns/adjectives
  if (COMMON_FIRST_NAMES.has(firstLower)) {
    const lastLower = parts[parts.length - 1].toLowerCase();
    if (BAND_START_WORDS.has(lastLower)) {
      return cleaned;
    }
    const lastName = parts.pop();
    const firstNames = parts.join(' ');
    return `${lastName}, ${firstNames}`;
  }

  // If not recognized as a personal name, preserve natural band order
  return cleaned;
}

export function groupTracksBySide(tracks) {
  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return null;
  }

  const sideGroups = new Map();
  let detectedSides = 0;
  let lastSideKey = null;

  for (const track of tracks) {
    const rawPos = (track.position || '').trim();
    let sideKey = null;

    // Pattern 1: A, A1, A-1, B2, C1, D4, AA1, etc.
    const letterMatch = rawPos.match(/^([A-Za-z]+)\s*[-.]?\s*\d*$/);
    // Pattern 2: Side A, Side 1, Face A
    const sideWordMatch = rawPos.match(/^(?:Side|Face)\s*([A-Za-z0-9]+)/i);
    // Pattern 3: 1-1, 1-2, 2-1 (disc-track)
    const discMatch = rawPos.match(/^(\d+)[-.]\d+$/);

    if (sideWordMatch) {
      sideKey = sideWordMatch[1].toUpperCase();
      detectedSides++;
    } else if (letterMatch) {
      sideKey = letterMatch[1].toUpperCase();
      detectedSides++;
    } else if (discMatch) {
      sideKey = `Disc ${discMatch[1]}`;
      detectedSides++;
    } else if (lastSideKey && !rawPos) {
      sideKey = lastSideKey;
    }

    if (!sideKey) {
      sideKey = 'Other';
    } else {
      lastSideKey = sideKey;
    }

    if (!sideGroups.has(sideKey)) {
      sideGroups.set(sideKey, []);
    }
    sideGroups.get(sideKey).push(track);
  }

  if (detectedSides === 0 || (sideGroups.size === 1 && sideGroups.has('Other'))) {
    return null;
  }

  return Array.from(sideGroups.entries()).map(([key, sideTracks]) => {
    let title;
    if (key.startsWith('Disc ')) {
      title = key;
    } else if (key === 'Other') {
      title = 'Bonus / Other';
    } else {
      title = `Side ${key}`;
    }
    return {
      sideKey: key,
      title,
      tracks: sideTracks,
    };
  });
}

export function calculateTotalDuration(tracks) {
  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return null;
  }

  let totalSeconds = 0;
  let parsedCount = 0;

  for (const track of tracks) {
    const raw = (track.duration || '').trim();
    if (!raw) continue;

    const parts = raw.split(':').map((p) => parseInt(p, 10));
    if (parts.some(isNaN)) continue;

    if (parts.length === 2) {
      totalSeconds += parts[0] * 60 + parts[1];
      parsedCount++;
    } else if (parts.length === 3) {
      totalSeconds += parts[0] * 3600 + parts[1] * 60 + parts[2];
      parsedCount++;
    }
  }

  const totalTracks = tracks.length;

  // If at least half the tracks have duration, estimate the remainder using average or ~4 min
  if (parsedCount > 0 && parsedCount < totalTracks && parsedCount / totalTracks >= 0.5) {
    const avgSeconds = Math.round(totalSeconds / parsedCount);
    const fallbackPerTrack = (avgSeconds >= 120 && avgSeconds <= 420) ? avgSeconds : 240;
    const missingCount = totalTracks - parsedCount;
    totalSeconds += missingCount * fallbackPerTrack;
    parsedCount = totalTracks;
  }

  if (parsedCount === 0 || totalSeconds <= 0) {
    return null;
  }

  // Round to nearest minute
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes <= 0) return null;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
  }
  return `${minutes} min`;
}

// Discogs collection "notes" are custom fields (by default: Media Condition, Sleeve Condition, Notes),
// each identified by a field id. Read them by name so condition grades never masquerade as notes.
const DEFAULT_FIELD_NAMES = new Map([[1, 'Media Condition'], [2, 'Sleeve Condition'], [3, 'Notes']]);

export async function fetchCollectionFieldNames(username) {
  try {
    const res = await discogsFetch(`/users/${encodeURIComponent(username)}/collection/fields`);
    if (!res.ok) return DEFAULT_FIELD_NAMES;
    const data = await res.json();
    const map = new Map((data.fields || []).map((f) => [f.id, f.name]));
    return map.size > 0 ? map : DEFAULT_FIELD_NAMES;
  } catch {
    return DEFAULT_FIELD_NAMES;
  }
}

export function parseCollectionFields(notes, fieldNames = DEFAULT_FIELD_NAMES) {
  const out = { mediaCondition: '', sleeveCondition: '', collectionNotes: [] };
  for (const n of notes || []) {
    const value = String(n.value || '').trim();
    if (!value) continue;
    const name = fieldNames.get(n.field_id) || `Field ${n.field_id}`;
    if (/media/i.test(name) && /condition/i.test(name)) out.mediaCondition = value;
    else if (/sleeve/i.test(name) && /condition/i.test(name)) out.sleeveCondition = value;
    else out.collectionNotes.push({ name, value });
  }
  return out;
}

// Refresh only the condition grades and notes on records that are already in the crate (one request per 100 records)
export async function refreshCollectionFields(username) {
  const fieldNames = await fetchCollectionFieldNames(username);
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const res = await discogsFetch(`/users/${encodeURIComponent(username)}/collection/folders/0/releases?page=${page}&per_page=100`);
    if (!res.ok) return;
    const data = await res.json();
    totalPages = data.pagination?.pages || 1;

    for (const item of data.releases || []) {
      const fields = parseCollectionFields(item.notes, fieldNames);
      try {
        await updateRecord(`discogs_${item.id}`, {
          mediaCondition: fields.mediaCondition,
          sleeveCondition: fields.sleeveCondition,
          collectionNotes: fields.collectionNotes,
          notes: fields.collectionNotes.map((n) => n.value).join('\n'),
        });
      } catch {
        // Not in the local crate yet; a full sync will add it
      }
    }
    page++;
  }
}

// A full sync reads the whole collection and picks up edits and removals. Otherwise it reads only as far as the newest
// records we don't have yet (usually one request), and falls back to a full read whenever the numbers don't add up.
export async function syncDiscogsCollection(username, onProgress, { full = false } = {}) {
  const meta = readSyncMeta(username);
  const readEverything = needsFullSync(meta, Date.now(), full);
  let total = null;
  let stoppedEarly = false;
  let page = 1;
  let totalPages = 1;
  const perPage = 100;
  const fetchedRecords = [];

  const existingRecords = await getAllRecords();
  const existingMap = new Map(existingRecords.map((r) => [r.id, r]));
  const fieldNames = await fetchCollectionFieldNames(username);

  while (page <= totalPages) {
    const res = await discogsFetch(`/users/${encodeURIComponent(username)}/collection/folders/0/releases?page=${page}&per_page=${perPage}&sort=added&sort_order=desc`);

    if (!res.ok) {
      const detail = await res.json().then((body) => body.error || body.message, () => '').catch(() => '');
      throw new Error(`Discogs fetch error (${res.status})${detail ? `: ${detail}` : ''}`);
    }

    const data = await res.json();
    if (data.pagination && data.pagination.pages) {
      totalPages = data.pagination.pages;
    }

    const parsed = (data.releases || []).map((item) => {
      const basic = item.basic_information || {};
      const artistName = basic.artists && basic.artists.length > 0
        ? basic.artists[0].name
        : 'Unknown Artist';
      const recordId = `discogs_${item.id}`;
      const existing = existingMap.get(recordId);
      const fields = parseCollectionFields(item.notes, fieldNames);

      const existingTracklist = existing?.tracklist && existing.tracklist.length > 0
        ? existing.tracklist
        : [];

      const discogsArtwork = {
        thumbnail: basic.thumb || '',
        highRes: basic.cover_image || '',
        source: 'discogs',
      };

      // Keep validated high-res artwork if already enriched, otherwise use Discogs artwork
      const existingArtwork = (['itunes', 'deezer'].includes(existing?.artwork?.source) && existing?.artwork?.highRes)
        ? existing.artwork
        : discogsArtwork;

      const titleStr = basic.title || 'Untitled';
      const isExpandedEdition = isEditionTitle(titleStr);
      const chosenYear = (isExpandedEdition && basic.year)
        ? basic.year
        : (existing?.year || existing?.originalYear || basic.master_year || existing?.masterYear || basic.year || 0);

      return {
        id: recordId,
        discogsId: item.id,
        masterId: basic.master_id || existing?.masterId || null,
        title: titleStr,
        artist: artistName.replace(/\s\(\d+\)$/, '').trim(),
        sortArtist: parseSortArtist(artistName),
        year: chosenYear,
        masterYear: basic.master_year || existing?.masterYear || null,
        originalYear: isExpandedEdition && basic.year
          ? basic.year
          : (existing?.originalYear || basic.master_year || existing?.masterYear || null),
        pressingYear: basic.year || existing?.pressingYear || null,
        releaseDate: existing?.releaseDate || null,
        genres: basic.genres || [],
        styles: basic.styles || [],
        format: basic.formats ? basic.formats.map((f) => f.name) : ['Vinyl'],
        dateAdded: item.date_added || new Date().toISOString(),
        notes: fields.collectionNotes.map((n) => n.value).join('\n'),
        mediaCondition: fields.mediaCondition,
        sleeveCondition: fields.sleeveCondition,
        collectionNotes: fields.collectionNotes,
        tracklist: existingTracklist,
        artwork: existingArtwork,
        discogsArtwork,
        context: existing?.context || null,
      };
    });

    fetchedRecords.push(...parsed);
    total = data.pagination?.items ?? total;
    if (onProgress) {
      onProgress({ page, totalPages, count: fetchedRecords.length, quick: !readEverything });
    }

    if (!readEverything && canStopEarly({
      pageHasKnown: parsed.some((r) => existingMap.has(r.id)),
      storedTotal: meta.storedTotal,
      total,
      newCount: fetchedRecords.filter((r) => !existingMap.has(r.id)).length,
    })) {
      stoppedEarly = true;
      break;
    }
    page++;
  }

  writeSyncMeta(username, { storedTotal: total, lastFullAt: stoppedEarly ? meta.lastFullAt : Date.now() });

  await upsertRecords(fetchedRecords);

  // A complete read shows what's gone from Discogs too
  let removed = 0;
  if (!stoppedEarly) {
    const gone = removedRecordIds(existingRecords, fetchedRecords.map((r) => r.id), { total, fetchedCount: fetchedRecords.length });
    if (gone.length > 0) await deleteRecords(gone);
    removed = gone.length;
  }

  return { records: fetchedRecords, added: fetchedRecords.filter((r) => !existingMap.has(r.id)).length, removed, quick: stoppedEarly };
}

// Find each record's original release year from its Discogs master. This decides where a record files in the crate, so it
// runs before the other background work. Records that share a master cost one request between them.
export async function enrichYearsInBackground(records, onEach) {
  const byMaster = new Map();
  for (const record of records) {
    if (!record.masterId || record.masterYear != null || record.masterChecked) continue;
    if (!byMaster.has(record.masterId)) byMaster.set(record.masterId, []);
    byMaster.get(record.masterId).push(record);
  }

  for (const [masterId, group] of byMaster) {
    let res;
    try {
      res = await discogsFetch(`/masters/${masterId}`, {}, 'low');
    } catch {
      continue;
    }
    if (res.status === 429) break;
    if (res.status === 404) {
      for (const record of group) await updateRecord(record.id, { masterChecked: true });
    } else if (res.ok) {
      const master = await res.json();
      for (const record of group) {
        const updates = masterYearUpdates(record, master);
        await updateRecord(record.id, updates);
        Object.assign(record, updates);
      }
    }
    if (onEach) onEach(group.length);
  }
}

export async function enrichTracklistsInBackground(records) {
  // Fetch release tracklist, and if durations are missing, match by title against master release
  // Respect Discogs API rate limits: max 60 requests/minute (~1 req/second)
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (const record of records) {
    const hasFullDurations = record.tracklist && record.tracklist.length > 0 &&
      record.tracklist.every((t) => Boolean(t.duration));

    if (!record.discogsId || hasFullDurations) continue;

    try {
      let currentTracklist = record.tracklist || [];

      // 1. Fetch release details if not already fetched
      if (currentTracklist.length === 0) {
        let res = null;
        try {
          res = await discogsFetch(`/releases/${record.discogsId}`, {}, 'low');
        } catch {
          // Network / CORS / preflight failure
          continue;
        }

        if (res.status === 429) {
          // Throttled by Discogs - pause for 60 seconds and stop this background cycle
          console.warn('Discogs rate limit reached (429). Pausing background tracklist enrichment.');
          await delay(60000);
          break;
        }

        if (res.ok) {
          const data = await res.json();
          currentTracklist = (data.tracklist || [])
            .filter((t) => (!t.type_ || t.type_ === 'track') && t.title)
            .map((t, idx) => ({
              position: t.position || String(idx + 1),
              title: t.title || '',
              duration: t.duration || '',
            }));
          if (!record.masterId && data.master_id) {
            record.masterId = data.master_id;
            await updateRecord(record.id, { masterId: data.master_id });
          }
        }
      }

      // If Discogs returned no tracks or was rate-limited / unavailable, attempt iTunes fallback for full tracklist
      if (currentTracklist.length === 0) {
        try {
          const query = encodeURIComponent(`${record.artist} ${record.title}`);
          const itunesRes = await itunesFetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=50`);
          if (itunesRes.ok) {
            const itunesData = await itunesRes.json();
            const songs = (itunesData.results || []).filter((s) => s.trackName);
            if (songs.length > 0) {
              // Sort songs by trackNumber if available
              songs.sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
              currentTracklist = songs.map((s, idx) => {
                let dur = '';
                if (s.trackTimeMillis) {
                  const totalSec = Math.round(s.trackTimeMillis / 1000);
                  const m = Math.floor(totalSec / 60);
                  const sec = String(totalSec % 60).padStart(2, '0');
                  dur = `${m}:${sec}`;
                }
                return {
                  position: s.trackNumber ? String(s.trackNumber) : String(idx + 1),
                  title: s.trackName || '',
                  duration: dur,
                };
              });
            }
          }
        } catch {
          // Ignore iTunes search errors
        }
      }

      if (currentTracklist.length === 0) continue;

      // 2. Check if we need duration enrichment
      const missingDurations = currentTracklist.some((t) => !t.duration);

      if (missingDurations && record.masterId) {
        try {
          const masterRes = await discogsFetch(`/masters/${record.masterId}`, {}, 'low');

          if (masterRes.status === 429) {
            console.warn('Discogs rate limit reached (429). Pausing background tracklist enrichment.');
            await delay(60000);
            break;
          }

          if (masterRes.ok) {
            const masterData = await masterRes.json();
            const masterTracks = (masterData.tracklist || []).filter((t) => (!t.type_ || t.type_ === 'track') && t.duration);

            if (masterData.year) {
              const updates = masterYearUpdates(record, masterData);
              Object.assign(record, updates);
              await updateRecord(record.id, updates);
            }

            const normalizeTitle = (str) =>
              str.toLowerCase().replace(/[^a-z0-9]/g, '');

            const masterLookup = new Map();
            for (const mt of masterTracks) {
              const norm = normalizeTitle(mt.title);
              if (norm && mt.duration) {
                masterLookup.set(norm, mt.duration);
              }
            }

            for (const t of currentTracklist) {
              if (!t.duration) {
                const norm = normalizeTitle(t.title);
                if (masterLookup.has(norm)) {
                  t.duration = masterLookup.get(norm);
                }
              }
            }
          }
        } catch {
          // If master lookup fails, continue with whatever durations we have
        }
      }

      // 3. Fallback: For any tracks still missing durations, try matching against iTunes album tracks
      const stillMissing = currentTracklist.some((t) => !t.duration);
      if (stillMissing) {
        try {
          const query = encodeURIComponent(`${record.artist} ${record.title}`);
          const itunesRes = await itunesFetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=50`);
          if (itunesRes.ok) {
            const itunesData = await itunesRes.json();
            const normalizeTitle = (str) =>
              str.toLowerCase().replace(/[^a-z0-9]/g, '');

            const itunesLookup = new Map();
            for (const song of itunesData.results || []) {
              if (song.trackName && song.trackTimeMillis) {
                const norm = normalizeTitle(song.trackName);
                const totalSec = Math.round(song.trackTimeMillis / 1000);
                const m = Math.floor(totalSec / 60);
                const s = String(totalSec % 60).padStart(2, '0');
                itunesLookup.set(norm, `${m}:${s}`);
              }
            }

            for (const t of currentTracklist) {
              if (!t.duration) {
                const norm = normalizeTitle(t.title);
                if (itunesLookup.has(norm)) {
                  t.duration = itunesLookup.get(norm);
                }
              }
            }
          }
        } catch {
          // Ignore iTunes search errors
        }
      }

      // Only write to database if we obtained tracks (never wipe out a tracklist)
      if (currentTracklist.length > 0) {
        await updateRecord(record.id, { tracklist: currentTracklist });
      }
    } catch {
      // Continue to next album if fetch fails
    }
  }
}

function cleanAlphaNum(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scoreAlbumMatch(recordArtist, recordTitle, itunesArtist, itunesAlbum) {
  const rArtist = cleanAlphaNum(recordArtist);
  const rTitle = cleanAlphaNum(recordTitle);
  const iArtist = cleanAlphaNum(itunesArtist);
  const iAlbum = cleanAlphaNum(itunesAlbum);

  if (!rTitle || !iAlbum) return -1;

  let titleScore = -1;
  if (rTitle === iAlbum) {
    titleScore = 100;
  } else if (iAlbum.startsWith(rTitle)) {
    const suffix = iAlbum.slice(rTitle.length);
    // Disqualify distinct follow-ups, companion releases, side b, part 2, vol 2 unless original title explicitly has them
    if (/(sideb|sided|part\d|vol\d|volume\d|chapter\d)/.test(suffix)) {
      titleScore = -1;
    } else if (/^(deluxe|expanded|anniversary|legacy|remaster|remastered|edition|special|version|\d+th)/.test(suffix)) {
      titleScore = 80;
    } else {
      titleScore = 40;
    }
  } else if (rTitle.startsWith(iAlbum)) {
    const suffix = rTitle.slice(iAlbum.length);
    if (/(sideb|sided|part\d|vol\d|volume\d|chapter\d)/.test(suffix)) {
      titleScore = -1;
    } else {
      titleScore = 70;
    }
  }

  let artistScore = -1;
  if (rArtist === iArtist) {
    artistScore = 100;
  } else if (iArtist && rArtist && (iArtist.includes(rArtist) || rArtist.includes(iArtist))) {
    artistScore = 60;
  }

  if (titleScore < 60 || artistScore < 60) return -1;
  return titleScore + artistScore;
}

// iTunes uses its own coarse genre names; fold them into the Discogs vocabulary so tags line up
const ITUNES_GENRE_MAP = {
  'pop': 'Pop',
  'k-pop': 'Pop',
  'rock': 'Rock',
  'alternative': 'Rock',
  'hard rock': 'Rock',
  'metal': 'Rock',
  'punk': 'Rock',
  'indie rock': 'Rock',
  'electronic': 'Electronic',
  'dance': 'Electronic',
  'jazz': 'Jazz',
  'r&b/soul': 'Funk / Soul',
  'soul': 'Funk / Soul',
  'funk': 'Funk / Soul',
  'hip-hop/rap': 'Hip Hop',
  'hip-hop': 'Hip Hop',
  'rap': 'Hip Hop',
  'classical': 'Classical',
  'soundtrack': 'Stage & Screen',
  'country': 'Folk, World, & Country',
  'folk': 'Folk, World, & Country',
  'singer/songwriter': 'Folk, World, & Country',
  'world': 'Folk, World, & Country',
  'blues': 'Blues',
  'reggae': 'Reggae',
  'latin': 'Latin',
  'motown': 'Funk / Soul',
  'disco': 'Funk / Soul',
  'neo-soul': 'Funk / Soul',
  'house': 'Electronic',
  'techno': 'Electronic',
  'ambient': 'Electronic',
  'trip-hop': 'Electronic',
  'teen pop': 'Pop',
  'vocal pop': 'Pop',
  'adult alternative': 'Rock',
  'college rock': 'Rock',
  'indie': 'Rock',
  // Already in Discogs' vocabulary
  'funk / soul': 'Funk / Soul',
  'hip hop': 'Hip Hop',
  'stage & screen': 'Stage & Screen',
  'folk, world, & country': 'Folk, World, & Country',
};

// We store iTunes' genre name as-is and translate on read, so the mapping can improve without re-fetching.
// Names we don't recognise are ignored; Discogs' own genres remain the fallback.
export function normalizeItunesGenre(name) {
  if (!name) return null;
  return ITUNES_GENRE_MAP[String(name).trim().toLowerCase()] || null;
}

// Genre-level tags for a record (used for browse tabs). Primary genre first, then Discogs genres.
export function getGenreTags(record) {
  return uniqueTags([normalizeItunesGenre(record.primaryGenre), ...(record.genres || [])]);
}

// Every tag for display, broadest to finest: primary genre, other genres, then styles.
export function getRecordTags(record) {
  return uniqueTags([normalizeItunesGenre(record.primaryGenre), ...(record.genres || []), ...(record.styles || [])]);
}

// Shorter names for tabs, tags and the inspector where Discogs' are long
const TAG_LABELS = {
  'Funk / Soul': 'Soul & Funk',
  'Folk, World, & Country': 'Folk & World',
};

export function tagLabel(tag) {
  return TAG_LABELS[tag] || tag;
}

function uniqueTags(list) {
  const seen = new Set();
  const out = [];
  for (const tag of list) {
    if (!tag) continue;
    const key = String(tag).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

// Best iTunes album match for a record; `ok` is false when iTunes could not be reached (rate limit, offline)
async function findItunesAlbum(record) {
  const cleanTitle = (record.title || '').replace(/\.{2,}$/, '').trim();
  const query = encodeURIComponent(`${record.artist} ${cleanTitle}`);
  let res = await itunesFetch(`https://itunes.apple.com/search?term=${query}&entity=album&limit=10`);
  if (!res.ok) return { ok: false, item: null };
  let data = await res.json();

  // Fallback: If entity=album returns 0 results, query with media=music (Apple frequently omits new releases from entity=album)
  if (!data || data.resultCount === 0) {
    const fallbackRes = await itunesFetch(`https://itunes.apple.com/search?term=${query}&media=music&limit=15`);
    if (fallbackRes.ok) {
      data = await fallbackRes.json();
    }
  }

  const scoredCandidates = (data?.results || [])
    .map((item) => ({
      item,
      score: scoreAlbumMatch(
        record.artist,
        record.title,
        item.artistName,
        item.collectionName || item.trackName
      ),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return { ok: true, item: scoredCandidates[0]?.item || null };
}

// Clean cover art from iTunes for records Deezer didn't have (or couldn't be asked about). Resumable: each record is marked once
// iTunes has actually answered for it, so an interrupted pass picks up where it stopped on the next load.
export async function enrichArtInBackground(records, onEach) {
  for (const record of records) {
    if (!needsItunesArt(record)) continue;
    try {
      const { ok, item: best } = await findItunesAlbum(record);
      if (!ok) break; // throttled or offline: leave the rest for next time

      if (best && best.artworkUrl100) {
        const highRes = best.artworkUrl100.replace('100x100bb.jpg', '1200x1200bb.jpg');
        const updates = {
          artwork: {
            thumbnail: best.artworkUrl100,
            highRes,
            source: 'itunes',
          },
          primaryGenre: best.primaryGenreName || null,
          itunesUrl: best.collectionViewUrl || null,
          itunesArtistUrl: best.artistViewUrl || null,
          genreChecked: true,
          artChecked: true,
        };

        if (best.releaseDate) {
          updates.releaseDate = best.releaseDate;
          Object.assign(updates, itunesYearUpdates(record, parseInt(String(best.releaseDate).slice(0, 4), 10)));
        }
        await updateRecord(record.id, updates);
        if (onEach) onEach(record.id);
      } else {
        await updateRecord(record.id, { artChecked: true });
      }
    } catch {
      break;
    }
  }
}

// Records still showing Discogs' own image, which is often a collector's photograph of the sleeve. Deezer is asked first:
// it has clean square covers, no tight rate limit, and answers are cached at the edge. Whatever Deezer doesn't have goes
// on to iTunes. (fallbackArtChecked is what an earlier version called deezerChecked.)
const isDemo = (record) => String(record.id).startsWith('discogs_mock_');
export const needsDeezerArt = (record) => record.artwork?.source === 'discogs' && !isDemo(record) && !record.deezerChecked && !record.fallbackArtChecked;
export const needsItunesArt = (record) => record.artwork?.source === 'discogs' && !isDemo(record) && !record.artChecked;

// Each record is marked once Deezer has actually answered, whether or not it had the album. A failure (Deezer down, or no
// server here) marks nothing and stops the pass: it says nothing about the album, so the next load asks again.
export async function enrichDeezerArtInBackground(records, onEach) {
  for (const record of records) {
    if (!needsDeezerArt(record)) continue;
    try {
      const res = await fetch(`/api/listen/deezer?artist=${encodeURIComponent(record.artist || '')}&title=${encodeURIComponent(record.title || '')}`);
      if (!res.ok) break;
      const { cover } = await res.json();
      const updates = { deezerChecked: true };
      if (cover) {
        updates.artwork = { thumbnail: cover.replace('1000x1000', '250x250'), highRes: cover, source: 'deezer' };
        if (onEach) onEach(record.id);
      }
      await updateRecord(record.id, updates);
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// Backfill iTunes' primary genre for records that predate it. Gentle on iTunes' rate limit; stops if throttled
// and simply tries again on the next load.
export async function enrichGenresInBackground(records) {
  for (const record of records) {
    try {
      const { ok, item } = await findItunesAlbum(record);
      if (!ok) break;
      await updateRecord(record.id, {
        primaryGenre: item?.primaryGenreName || null,
        itunesUrl: item?.collectionViewUrl || null,
        itunesArtistUrl: item?.artistViewUrl || null,
        genreChecked: true,
      });
    } catch {
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Full Discogs release details (label, credits, pressing, videos) for the album inspector
// ---------------------------------------------------------------------------

const stripDisambiguation = (name) => String(name || '').replace(/\s\(\d+\)$/, '').trim();

function youtubeId(uri) {
  const m = String(uri || '').match(/(?:youtube\.com\/watch\?[^#]*v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export function mapDiscogsTracklist(list) {
  return (list || [])
    .filter((t) => (!t.type_ || t.type_ === 'track') && t.title)
    .map((t, idx) => ({
      position: t.position || String(idx + 1),
      title: t.title || '',
      duration: t.duration || '',
    }));
}

export function parseReleaseDetails(data) {
  const seenLabels = new Set();
  const labels = [];
  for (const l of data.labels || []) {
    const entry = { name: stripDisambiguation(l.name), catno: l.catno && l.catno.toLowerCase() !== 'none' ? l.catno : '' };
    const key = `${entry.name}|${entry.catno}`;
    if (!entry.name || seenLabels.has(key)) continue;
    seenLabels.add(key);
    labels.push(entry);
  }

  return {
    labels,
    country: data.country || '',
    released: data.released || '',
    formats: (data.formats || []).map((f) => ({
      name: f.name || '',
      qty: f.qty || '1',
      descriptions: f.descriptions || [],
      text: f.text || '',
    })),
    artists: (data.artists || []).map((a) => ({ id: a.id, name: stripDisambiguation(a.name) })),
    credits: (data.extraartists || []).map((a) => ({
      id: a.id,
      name: stripDisambiguation(a.name),
      role: String(a.role || '').trim(),
    })).filter((c) => c.name && c.role),
    companies: (data.companies || []).map((c) => ({
      name: stripDisambiguation(c.name),
      role: c.entity_type_name || '',
    })).filter((c) => c.name && c.role),
    identifiers: (data.identifiers || [])
      .filter((i) => i.value && (i.type === 'Barcode' || i.type === 'Matrix / Runout'))
      .map((i) => ({ type: i.type, value: i.value, description: i.description || '' })),
    notes: data.notes || '',
    videos: (data.videos || [])
      .map((v) => ({ title: v.title || '', uri: v.uri, id: youtubeId(v.uri) }))
      .filter((v) => v.id),
    fetchedAt: new Date().toISOString(),
  };
}

// Discogs credit roles are free-form: several roles per person ("Written-By, Mixed By, Keyboards"), bracketed notes
// that are mostly noise ("Engineer [Assistant, Avast! Recording]"), and plenty of business roles. Split, classify
// each role on its own, and print only what a sleeve would.

// Split "Producer, Engineer [Assistant, Studio X], Guitar" on commas outside brackets
export function splitCreditRoles(role) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of String(role || '')) {
    if (ch === '[') depth++;
    if (ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);

  return parts.map((part) => {
    const detail = (part.match(/\[([^\]]*)\]/) || [])[1] || '';
    return { base: part.replace(/\s*\[[^\]]*\]/g, '').trim(), detail: detail.trim() };
  }).filter((p) => p.base);
}

const BUSINESS_ROLE = /^(management|marketing|a&r|legal|booking|public relations|pr\b|product manager|project manager|coordinator|contractor|advisor|consultant|business)/i;
const WRITING_ROLE = /^(written[- ]by|words by|lyrics by|music by|songwriter|composed by|arranged by|orchestrated by|liner notes|adapted by|translated by)/i;
const PRODUCTION_ROLE = /^(produc|executive[- ]produc|co-?produc|compilation produc|engineer|mixed by|recorded by|mastered by|remastered by|lacquer cut|cut by|edited by|editor|supervised by|directed by|remix)/i;
const ARTWORK_ROLE = /^(art direction|artwork|design|layout|photograph|illustrat|painting|cover|creative director|typograph|lettering|graphics)/i;
const OTHER_ROLE = /^(technician|model|hair|make-?up|stylist|other)/i;

// Anything unrecognised (there are endless instruments) counts as performing
function creditGroupFor(base) {
  if (BUSINESS_ROLE.test(base)) return null;
  if (WRITING_ROLE.test(base)) return 'Written & arranged';
  if (PRODUCTION_ROLE.test(base)) return 'Produced & engineered';
  if (ARTWORK_ROLE.test(base)) return 'Artwork & photography';
  if (OTHER_ROLE.test(base)) return 'Also credited';
  return 'Performed by';
}

// Keep a bracketed note only when it changes the meaning: assistant or additional
function creditLabel({ base, detail }) {
  if (/assist/i.test(detail)) return /^engineer$/i.test(base) ? 'Assistant engineer' : `${base} (assistant)`;
  if (/additional/i.test(detail)) return `${base} (additional)`;
  return base;
}

// Which "kinds" of credit a role string carries, for matching records to each other (writers and producers only)
export function creditKinds(role) {
  const kinds = new Set();
  for (const part of splitCreditRoles(role)) {
    if (/assist/i.test(part.detail)) continue;
    if (/^(written[- ]by|words by|lyrics by|music by|songwriter|composed by)/i.test(part.base)) kinds.add('writer');
    if (/^(co-?producer|producer|produced by)$/i.test(part.base)) kinds.add('producer');
  }
  return kinds;
}

const CREDIT_GROUP_ORDER = ['Performed by', 'Written & arranged', 'Produced & engineered', 'Artwork & photography', 'Also credited'];

export function groupCredits(details) {
  if (!details?.credits?.length) return [];

  const groups = new Map(CREDIT_GROUP_ORDER.map((title) => [title, new Map()]));

  for (const credit of details.credits) {
    for (const part of splitCreditRoles(credit.role)) {
      const title = creditGroupFor(part.base);
      if (!title) continue;
      const people = groups.get(title);
      const key = credit.id ? `id:${credit.id}` : `name:${credit.name.toLowerCase()}`;
      if (!people.has(key)) people.set(key, { id: credit.id || null, name: credit.name, roles: [] });
      const person = people.get(key);
      const label = creditLabel(part);
      if (!person.roles.includes(label)) person.roles.push(label);
    }
  }

  return CREDIT_GROUP_ORDER
    .map((title) => ({ title, people: [...groups.get(title).values()] }))
    .filter((g) => g.people.length > 0);
}

// Fetch one release from Discogs. `status` is 'ok', 'throttled' (429) or 'error'.
export async function fetchReleaseDetails(record, priority = 'high') {
  let res;
  try {
    res = await discogsFetch(`/releases/${record.discogsId}`, {}, priority);
  } catch {
    return { status: 'error' };
  }
  if (res.status === 429) return { status: 'throttled' };
  if (!res.ok) return { status: 'error' };

  const data = await res.json();
  return {
    status: 'ok',
    details: parseReleaseDetails(data),
    tracklist: mapDiscogsTracklist(data.tracklist),
    masterId: data.master_id || null,
  };
}

export const DETAILS_MAX_AGE_DAYS = 30;

// Saved details older than this are quietly fetched again the next time the record is looked at
export function detailsAreStale(record, now = Date.now()) {
  if (!record.details) return false;
  const fetched = Date.parse(record.details.fetchedAt || '');
  return !Number.isFinite(fetched) || now - fetched > DETAILS_MAX_AGE_DAYS * 86400000;
}

const detailsInFlight = new Map();

// Fetch a record's details and save them. One request per record at a time, however many callers ask. Resolves with
// the saved fields, or null if Discogs didn't answer.
export function loadRecordDetails(record, priority = 'high') {
  if (!detailsInFlight.has(record.id)) {
    const job = (async () => {
      const result = await fetchReleaseDetails(record, priority);
      if (result.status !== 'ok') return null;
      const updates = { details: result.details };
      if ((!record.tracklist || record.tracklist.length === 0) && result.tracklist.length > 0) {
        updates.tracklist = result.tracklist;
      }
      if (!record.masterId && result.masterId) updates.masterId = result.masterId;
      await updateRecord(record.id, updates);
      return updates;
    })().finally(() => detailsInFlight.delete(record.id));
    detailsInFlight.set(record.id, job);
  }
  return detailsInFlight.get(record.id);
}

// Backfill full release details, one gentle request at a time. Stops if throttled and resumes next load.
export async function enrichDetailsInBackground(records, onEach) {
  for (const record of records) {
    if (!record.discogsId || record.details) continue;

    const result = await fetchReleaseDetails(record, 'low');
    if (result.status === 'throttled') break;
    if (result.status === 'ok') {
      const updates = { details: result.details };
      if ((!record.tracklist || record.tracklist.length === 0) && result.tracklist.length > 0) {
        updates.tracklist = result.tracklist;
      }
      if (!record.masterId && result.masterId) updates.masterId = result.masterId;
      await updateRecord(record.id, updates);
      if (onEach) onEach(record.id);
    }
  }
}

// Links for an artist (official site, YouTube, Bandcamp...) from their Discogs profile
export async function fetchArtistLinks(artistId) {
  try {
    const res = await discogsFetch(`/artists/${artistId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.urls || []).slice(0, 12);
  } catch {
    return null;
  }
}

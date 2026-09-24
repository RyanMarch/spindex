// wiki.js - Wikipedia / Wikimedia / MusicBrainz / Cover Art Archive lookups for the album inspector.
// All calls are anonymous and CORS-enabled; results are cached on the record by the caller.

const WIKI_API = 'https://en.wikipedia.org/w/api.php';

const BACKGROUND_SECTION = /^(background|recording|production|writing|composition|concept|development|writing and recording|recording and production|background and recording|background and production|production and recording|music and lyrics)\b/i;
const RECEPTION_SECTION = /^(critical reception|reception|critical response|reviews|critical reviews)$/i;

async function getJSON(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Plain text from a chunk of Wikipedia article HTML: first paragraphs only, no citations, tables or figures
function paragraphsFromHTML(html, maxChars = 700) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('sup, table, style, figure, .thumb, .hatnote, .mw-editsection, .infobox, .reference, .navbox, .metadata').forEach((el) => el.remove());

  const out = [];
  let total = 0;
  for (const p of doc.querySelectorAll('p')) {
    const text = p.textContent.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
    if (text.length < 40) continue;
    out.push(text);
    total += text.length;
    if (total >= maxChars) break;
  }
  if (out.length === 0) return '';

  let joined = out.join('\n\n');
  if (joined.length > maxChars + 250) {
    // Trim to a sentence boundary so the snippet never stops mid-thought
    const cut = joined.lastIndexOf('. ', maxChars + 100);
    joined = cut > maxChars / 2 ? joined.slice(0, cut + 1) : joined;
  }
  return joined;
}

async function sectionText(title, index) {
  const data = await getJSON(`${WIKI_API}?action=parse&page=${encodeURIComponent(title)}&section=${index}&prop=text&format=json&origin=*&redirects=1`);
  const html = data?.parse?.text?.['*'];
  return html ? paragraphsFromHTML(html) : '';
}

// "Background / Recording" and "Critical reception" snippets from the album's article
export async function fetchAlbumSections(title) {
  const data = await getJSON(`${WIKI_API}?action=parse&page=${encodeURIComponent(title)}&prop=sections&format=json&origin=*&redirects=1`);
  const sections = data?.parse?.sections || [];
  const top = sections.filter((s) => Number(s.toclevel) <= 2);

  const findSection = (re) => top.find((s) => re.test(String(s.line).replace(/<[^>]+>/g, '').trim()));
  const background = findSection(BACKGROUND_SECTION);
  const reception = findSection(RECEPTION_SECTION);

  const [backgroundText, receptionText] = await Promise.all([
    background ? sectionText(title, background.index) : '',
    reception ? sectionText(title, reception.index) : '',
  ]);

  const result = {};
  if (backgroundText) result.background = { heading: String(background.line).replace(/<[^>]+>/g, ''), text: backgroundText };
  if (receptionText) result.reception = { heading: 'Critical reception', text: receptionText };
  return result;
}

function cleanWikiValue(raw) {
  return String(raw || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref\b[^>]*\/>/gi, '')
    .replace(/\{\{\s*(?:plainlist|unbulleted list|ubl|flatlist|hlist)\s*\|/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/^\s*[*|]+\s*/gm, '')
    .replace(/\n+/g, ', ')
    .replace(/[{}]/g, '')
    .replace(/\s*,\s*(?:,\s*)+/g, ', ')
    .replace(/^[\s,|]+|[\s,|]+$/g, '')
    .trim();
}

// Label / producer / studio from the album infobox
export async function fetchInfobox(title) {
  const data = await getJSON(`${WIKI_API}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&origin=*&redirects=1`);
  const wikitext = data?.parse?.wikitext?.['*'] || '';
  if (!wikitext) return {};

  const field = (name) => {
    const m = wikitext.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([\\s\\S]*?)(?=\\n\\s*\\|\\s*[a-z_ ]+=|\\n\\}\\})`, 'i'));
    const value = m ? cleanWikiValue(m[1]) : '';
    return value.length > 0 && value.length < 200 ? value : '';
  };

  const out = { label: field('label'), producer: field('producer'), recorded: field('recorded') };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

// Artist bio, links and a freely licensed portrait.
// Returns the bio, null when Wikipedia has no page for them, or undefined when Wikipedia couldn't be reached
// (so a network hiccup is retried instead of remembered as "no bio").
const MUSIC_ACT = /\b(band|musician|singer|rapper|duo|group|composer|producer|songwriter|dj|ensemble|trio|quartet|quintet|vocalist|guitarist|drummer|pianist|artist|collective|orchestra)\b/i;
const NOT_AN_ACT = /\b(album|song|single|ep|film|soundtrack|compilation|mixtape|tour|video|discography|list of)\b/i;

const normalizeName = (text) => String(text || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/^the\s+/, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

async function findArtistPage(artist) {
  const target = normalizeName(artist);
  const search = await getJSON(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(artist)}&limit=8`);
  if (!search) return undefined;

  // Title search returns each page's short description, so "The Cars" can be told from "The Cars (album)" in one call
  const hit = (search.pages || []).find((page) => {
    const title = normalizeName(page.title);
    const sameName = title === target || title.startsWith(`${target} `);
    const description = page.description || '';
    return sameName && MUSIC_ACT.test(description) && !NOT_AN_ACT.test(description);
  });
  return hit ? hit.title : null;
}

// "Various" / "Various Artists" is Discogs' placeholder for compilations, not a band
export const isVariousArtists = (artist) => /^various(\s+artists)?$/i.test(String(artist || '').trim());

const ALBUM_LIKE = /\b(album|ep|soundtrack|compilation|mixtape|lp|record|score|single)\b/i;

// Which of Wikipedia's title-search hits is the album: it must look like a record (by its short description), carry the
// album's title, and name the artist, so a title like "Bodies" or a homemade record can't land on some other page.
export function pickAlbumPage(pages, artist, title) {
  const wanted = normalizeName(String(title || '').replace(/\([^)]*\)/g, ''));
  if (!wanted) return null;
  const who = isVariousArtists(artist) ? '' : normalizeName(artist);

  const hit = (pages || []).find((page) => {
    const pageTitle = normalizeName(String(page.title).replace(/\([^)]*\)/g, ''));
    const description = page.description || '';
    if (pageTitle !== wanted || !ALBUM_LIKE.test(description)) return false;
    return !who || normalizeName(`${description} ${page.title}`).includes(who);
  });
  return hit ? hit.title : null;
}

// The Wikipedia article for an album, null when there isn't one, or undefined when Wikipedia couldn't be reached.
export async function findAlbumPage(artist, title) {
  if (!String(title || '').trim()) return null;
  for (const q of [`${title} ${artist} album`, `${title} album`, String(title)]) {
    const search = await getJSON(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=8`);
    if (!search) return undefined; // couldn't reach Wikipedia: don't remember that as "no article"
    const found = pickAlbumPage(search.pages, artist, title);
    if (found) return found;
  }
  return null;
}

export async function fetchArtistBio(artist) {
  const title = await findArtistPage(artist);
  if (title === undefined) return undefined;
  if (title === null) return null;

  const summary = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!summary) return undefined;
  if (summary.type === 'disambiguation') return null;

  const bio = {
    extract: summary.extract || '',
    url: summary.content_urls?.desktop?.page || '',
    description: summary.description || '',
    title: summary.title,
  };

  if (summary.wikibase_item) {
    const entity = await fetchWikidataEntity(summary.wikibase_item);
    if (entity) {
      if (entity.photo) bio.photo = entity.photo;
      bio.links = entity.links;
    }
  }
  return bio;
}

// One Wikidata call gives the portrait file and the artist's own places on the web
async function fetchWikidataEntity(qid) {
  const data = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json&origin=*`);
  const claims = data?.entities?.[qid]?.claims;
  if (!claims) return null;

  const first = (pid) => claims[pid]?.find((c) => c.rank !== 'deprecated')?.mainsnak?.datavalue?.value;
  const links = {
    website: first('P856') || null,
    instagram: first('P2003') || null,
    youtubeChannel: first('P2397') || null,
    soundcloud: first('P3040') || null,
    discogsId: first('P1953') || null,
    musicbrainzId: first('P434') || null,
  };

  const fileName = first('P18');
  const photo = fileName ? await fetchCommonsPhoto(fileName) : null;
  return { links, photo };
}

async function fetchCommonsPhoto(fileName) {
  const info = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(`File:${fileName}`)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900&format=json&origin=*`);
  const page = Object.values(info?.query?.pages || {})[0];
  const ii = page?.imageinfo?.[0];
  if (!ii) return null;

  const meta = ii.extmetadata || {};
  const strip = (v) => String(v || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return {
    url: ii.thumburl || ii.url,
    author: strip(meta.Artist?.value) || 'Unknown',
    license: strip(meta.LicenseShortName?.value) || '',
    page: ii.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}`,
  };
}

// Back cover from the Cover Art Archive (images are explicitly typed there), via MusicBrainz.
// MusicBrainz lists which releases have a back cover, so we only ask the archive about those (no guessing, no 404s).
// MusicBrainz asks for at most ~1 request per second.

const normalizeTitle = (text) => String(text || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

// The release group whose title is the album's, not just the search's first hit (a "Demos" edition can outrank it)
export function pickReleaseGroup(groups, title) {
  const wanted = normalizeTitle(title);
  return (groups || []).find((g) => normalizeTitle(g.title) === wanted) || (groups || [])[0] || null;
}

// A back cover has to show this kind of object: this is a record collection, so a cassette insert or a digital
// release's art is wrong even when the archive has it. Vinyl first, then CD.
const WRONG_FORMAT = /cassette|digital|vhs|dvd|blu-?ray|minidisc|8-?track|reel|cartridge/i;

export function pickBackCoverReleases(releases) {
  const formatsOf = (r) => (r.media || []).map((m) => m.format || '');
  const rank = (r) => {
    const formats = formatsOf(r);
    if (formats.some((f) => /vinyl/i.test(f))) return 0;
    if (formats.some((f) => /cd|sacd|hdcd/i.test(f))) return 1;
    return 2;
  };
  return (releases || [])
    .filter((r) => r['cover-art-archive']?.back && !formatsOf(r).some((f) => WRONG_FORMAT.test(f)))
    .map((release, order) => ({ release, order }))
    .sort((a, b) => rank(a.release) - rank(b.release) || a.order - b.order)
    .map((entry) => entry.release);
}

export async function fetchBackCover(artist, title) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cleanTitle = title.replace(/\([^)]*\)/g, '').trim();

  const groups = await getJSON(`https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(`artist:"${artist}" AND releasegroup:"${cleanTitle}"`)}&limit=5&fmt=json`);
  const group = pickReleaseGroup(groups?.['release-groups'], cleanTitle);
  if (!group) return null;

  await wait(1100);
  const listing = await getJSON(`https://musicbrainz.org/ws/2/release?release-group=${group.id}&inc=media&limit=100&fmt=json`);

  // Usually one release; a second is a fallback in case the archive's storage server has a hiccup
  for (const release of pickBackCoverReleases(listing?.releases).slice(0, 2)) {
    const archive = await getJSON(`https://coverartarchive.org/release/${release.id}`);
    const back = archive?.images?.find((img) => img.types?.includes('Back') && img.approved !== false);
    if (back) {
      const url = back.thumbnails?.['1200'] || back.thumbnails?.large || back.image;
      return url ? url.replace(/^http:/, 'https:') : null;
    }
  }
  return null;
}

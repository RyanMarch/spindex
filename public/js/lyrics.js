// lyrics.js - Fetch and parse lyrics from LRCLIB (lrclib.net) with client-side caching
const LRCLIB_BASE = 'https://lrclib.net/api';
const CLIENT_HEADER = 'Spindex/1.0 (https://github.com/RyanMarch/spindex)';
const CACHE_PREFIX = 'spindex_lyrics:';

// In-memory cache to avoid repeated network calls in the same session
const memoryCache = new Map();

/**
 * Remove Discogs disambiguation numbers, e.g. "Nirvana (2)" -> "Nirvana"
 */
export function cleanArtistName(artist) {
  return String(artist || '')
    .replace(/\s\(\d+\)$/, '')
    .trim();
}

/**
 * Clean track titles for better search matching on LRCLIB
 */
export function cleanTrackTitle(title) {
  if (!title) return '';
  let clean = String(title).trim();

  // Strip leading track numbers like "01. " or "A1. "
  clean = clean.replace(/^(?:[A-Z]\d|\d{1,2})[\.\-\s]\s*/i, '');

  // Strip common vinyl/reissue tags: "(Remastered 2011)", "- 2011 Remaster", "- 2019 Mix", "[Bonus Track]", etc.
  clean = clean.replace(/\s*-\s*\d{4}\s+(?:Remaster(?:ed)?|Mix|Stereo|Mono)(?:\s+Version)?/gi, '');
  clean = clean.replace(/\s*-\s*Remaster(?:ed)?(?:\s+\d{4})?(?:\s+Version)?/gi, '');
  clean = clean.replace(/\s*-\s*(?:Live|Mono|Stereo|Single Version|Album Version|Original Mix|.*Mix)$/i, '');
  clean = clean.replace(/\s*\((?:remastered|remaster|mono|stereo|bonus track|live|single version|album version|explicit|\d{4}\s+mix).*?\)/gi, '');
  clean = clean.replace(/\s*\[(?:remastered|remaster|mono|stereo|bonus track|live|explicit|\d{4}\s+mix).*?\]/gi, '');

  return clean.trim() || title.trim();
}

/**
 * Parse "MM:SS" or "HH:MM:SS" strings to total seconds
 */
export function parseDurationToSeconds(durationStr) {
  if (!durationStr || typeof durationStr !== 'string') return null;
  const parts = durationStr.trim().split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

/**
 * Generate a cache key for an artist + track title
 */
function makeCacheKey(artist, title) {
  const cleanA = cleanArtistName(artist).toLowerCase();
  const cleanT = cleanTrackTitle(title).toLowerCase();
  return `${cleanA}|${cleanT}`;
}

/**
 * Read from memory or sessionStorage cache
 */
function getCached(key) {
  if (memoryCache.has(key)) return memoryCache.get(key);
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      memoryCache.set(key, parsed);
      return parsed;
    }
  } catch {
    // sessionStorage might be restricted
  }
  return null;
}

/**
 * Save to memory and sessionStorage cache
 */
function setCache(key, value) {
  memoryCache.set(key, value);
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // sessionStorage quota exceeded or restricted
  }
}

/**
 * Escape HTML special characters
 */
export function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

/**
 * Formats plain text lyrics into structured HTML paragraphs with stanzas
 */
export function formatLyricsHTML(plainLyrics) {
  if (!plainLyrics || !plainLyrics.trim()) return '';
  const stanzas = plainLyrics
    .trim()
    .split(/\n\s*\n/)
    .map((stanza) => {
      const lines = stanza
        .split('\n')
        .map((line) => escapeHTML(line.trim()))
        .join('<br>');
      return `<p class="lyrics-stanza">${lines}</p>`;
    });
  return `<div class="lyrics-body-text">${stanzas.join('')}</div>`;
}

/**
 * Fetch lyrics for a track from LRCLIB
 */
export async function fetchLyrics({ artist, title, album = '', duration = '' }) {
  const cleanArtist = cleanArtistName(artist);
  const cleanTitle = cleanTrackTitle(title);
  const cacheKey = makeCacheKey(cleanArtist, cleanTitle);

  const cached = getCached(cacheKey);
  if (cached) return cached;

  const seconds = parseDurationToSeconds(duration);

  // Step 1: Try exact lookup via /api/get
  try {
    const params = new URLSearchParams({
      artist_name: cleanArtist,
      track_name: cleanTitle,
    });
    if (album) params.set('album_name', album);
    if (seconds) params.set('duration', String(seconds));

    const res = await fetch(`${LRCLIB_BASE}/get?${params.toString()}`, {
      headers: {
        'Lrclib-Client': CLIENT_HEADER,
      },
    });

    if (res.ok) {
      const data = await res.json();
      const result = {
        found: true,
        instrumental: Boolean(data.instrumental),
        plainLyrics: data.plainLyrics || '',
        syncedLyrics: data.syncedLyrics || '',
        trackName: data.trackName || cleanTitle,
        artistName: data.artistName || cleanArtist,
      };
      setCache(cacheKey, result);
      return result;
    }

    if (res.status === 429) {
      return { found: false, rateLimited: true };
    }
  } catch {
    // Exact request failed, fall through to search
  }

  // Step 2: Fallback to fuzzy search via /api/search
  try {
    const searchParams = new URLSearchParams({
      artist_name: cleanArtist,
      track_name: cleanTitle,
    });
    const res = await fetch(`${LRCLIB_BASE}/search?${searchParams.toString()}`, {
      headers: {
        'Lrclib-Client': CLIENT_HEADER,
      },
    });

    if (res.ok) {
      const items = await res.json();
      if (Array.isArray(items) && items.length > 0) {
        // Find best match with lyrics or marked instrumental
        const match = items.find((it) => it.plainLyrics || it.instrumental) || items[0];
        const result = {
          found: true,
          instrumental: Boolean(match.instrumental),
          plainLyrics: match.plainLyrics || '',
          syncedLyrics: match.syncedLyrics || '',
          trackName: match.trackName || cleanTitle,
          artistName: match.artistName || cleanArtist,
        };
        setCache(cacheKey, result);
        return result;
      }
    }
  } catch {
    // Search failed
  }

  const notFoundResult = { found: false };
  setCache(cacheKey, notFoundResult);
  return notFoundResult;
}

// cache.js - the edge cache in front of Discogs. Release, master and artist pages are the same for everyone, so once
// any request has fetched one, later requests (a re-sync, your partner's phone) are answered from Cloudflare's
// cache in that data centre instead of spending Discogs' 60-a-minute budget. Your collection is private and is
// never cached. Marketplace figures (prices, copies for sale) are the fast-moving data Discogs' six-hour rule is about,
// and Spindex never shows them, so they are removed before anything is stored.

const DEFAULT_TTL = 30 * 24 * 60 * 60; // a pressing's tracklist and credits almost never change; Discogs confirmed the six-hour rule targets pricing
const MAX_TTL = 30 * 24 * 60 * 60;

const MARKETPLACE_FIELDS = ['lowest_price', 'num_for_sale'];

// JSON text in, JSON text out without the marketplace fields. Anything that isn't JSON passes through untouched.
export function stripMarketplace(text) {
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return text;
    for (const field of MARKETPLACE_FIELDS) delete data[field];
    return JSON.stringify(data);
  } catch {
    return text;
  }
}

// upstreamPath: the "/path?query" the proxy already vetted. Returns the cache key path, or null if it isn't cacheable.
export function cacheablePath(upstreamPath) {
  const [path, query] = String(upstreamPath).split('?');
  if (/^\/(releases|masters|artists)\/\d+$/.test(path)) return path;
  if (path === '/database/search' && query) {
    const params = new URLSearchParams(query);
    const barcode = params.get('barcode');
    if (barcode) return `/database/search?barcode=${encodeURIComponent(barcode)}`;
  }
  return null;
}

// A made-up URL, so the key never depends on the person's cookies or headers
export const cacheKey = (path) => new Request(`https://cache.spindex.internal/discogs${path}`);

// DISCOGS_CACHE_SECONDS overrides the default; 0 turns caching off
export function ttlSeconds(env) {
  const raw = env?.DISCOGS_CACHE_SECONDS;
  if (raw === undefined || raw === '') return DEFAULT_TTL;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), MAX_TTL) : DEFAULT_TTL;
}

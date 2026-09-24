// external.js - how the page reads Wikipedia, Wikidata, Commons, MusicBrainz and the Cover Art Archive. Requests go
// through our own /api/ext, which keeps a shared edge cache (a second device gets answers without waiting on the source)
// and identifies the app properly to each service. If there is no server (a static preview, offline), it goes direct.
import { createLimiter } from './limiter.js';

const PROXIED = new Set(['en.wikipedia.org', 'www.wikidata.org', 'commons.wikimedia.org', 'musicbrainz.org', 'coverartarchive.org']);
const isHit = (res) => res?.headers?.get?.('x-spindex-cache') === 'HIT';

async function viaProxy(url) {
  try {
    const res = await fetch(`/api/ext?url=${encodeURIComponent(url)}`);
    if (res.headers.get('x-spindex-proxy')) return res; // the proxy answered, even if with an error
  } catch {
    // fall through
  }
  return fetch(url);
}

// MusicBrainz allows about one request a second. Answers from the cache cost it nothing, so they don't wait.
const musicbrainz = createLimiter({
  pace: (res) => (isHit(res) ? 0 : 1100),
  throttled: (res) => res && (res.status === 429 || res.status === 503),
  maxRetries: 2,
});

export function externalFetch(url) {
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    return fetch(url);
  }
  if (!PROXIED.has(host)) return fetch(url);
  return host === 'musicbrainz.org' ? musicbrainz.schedule(() => viaProxy(url), 'low') : viaProxy(url);
}

// JSON, or null when the source has nothing (a 404). Anything else that goes wrong throws, so a hiccup is never
// mistaken for "there is no such thing" and remembered.
export async function externalJSON(url) {
  const res = await externalFetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

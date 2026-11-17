// telemetry.js - a short server-side record of Discogs slow-downs (429s), for the admin page. It holds no names, no
// releases and no cookies: only when it happened, what kind of request it was, which Cloudflare data centre sent it, and
// the budget Discogs reported. That is enough to tell whether the proxy's shared address or Spindex itself ran out.

export const LOG_PREFIX = 'log:discogs:';
const KEEP_SECONDS = 30 * 24 * 60 * 60;

// What was being asked for, without the user's name or the release number
export function pathKind(path = '') {
  if (/\/collection\//.test(path)) return 'collection';
  if (/\/releases\//.test(path)) return 'release';
  if (/\/masters\//.test(path)) return 'master';
  if (/\/artists\//.test(path)) return 'artist';
  if (/\/database\/search/.test(path)) return 'search';
  return 'other';
}

const num = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

// Returns the event to keep, or null for an answer that is not worth recording
export function buildEvent({ status, headers, path, colo, now = Date.now() }) {
  if (status !== 429) return null;
  return {
    at: now,
    kind: pathKind(path),
    used: num(headers?.get?.('x-discogs-ratelimit-used')),
    limit: num(headers?.get?.('x-discogs-ratelimit')),
    retryAfter: num(headers?.get?.('retry-after')),
    colo: String(colo || 'unknown').slice(0, 8),
  };
}

// Newest first when listed: the key counts down from a far-future time. The event itself rides in the key's metadata,
// so one list call reads everything.
export function eventKey(at, random = Math.random) {
  return `${LOG_PREFIX}${String(9999999999999 - at).padStart(13, '0')}:${random().toString(36).slice(2, 8)}`;
}

export async function recordEvent(env, event) {
  if (!event || !env?.DISCOGS_DATA) return;
  try {
    await env.DISCOGS_DATA.put(eventKey(event.at), '1', { expirationTtl: KEEP_SECONDS, metadata: event });
  } catch {
    // A log must never get in the way of the request it describes
  }
}

export async function readEvents(env, limit = 500) {
  if (!env?.DISCOGS_DATA) return [];
  const out = [];
  let cursor;
  do {
    const page = await env.DISCOGS_DATA.list({ prefix: LOG_PREFIX, limit: 1000, cursor });
    for (const key of page.keys) if (key.metadata) out.push(key.metadata);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < limit);
  return out.slice(0, limit);
}

const median = (list) => {
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

// A read of the pattern: a low typical 'used' means something other than Spindex spent the budget
export function summarize(events) {
  const count = (field) => events.reduce((acc, e) => ({ ...acc, [e[field]]: (acc[e[field]] || 0) + 1 }), {});
  const used = events.map((e) => e.used).filter((v) => v !== null && v !== undefined);
  const medianUsed = median(used);
  return {
    total: events.length,
    byColo: count('colo'),
    byKind: count('kind'),
    medianUsed,
    reading: medianUsed === null
      ? 'Discogs has not reported its budget on these, so the cause is unknown.'
      : medianUsed > 60
        ? 'Discogs had counted more requests than the whole limit, far more than Spindex sends on its own. That points to other traffic on the same address.'
        : medianUsed < 30
          ? 'Discogs refused requests while few had been counted against the budget, which points to a shared address.'
          : 'Discogs refused requests with the budget nearly spent. Spindex may be using it, so check how much it was sending.',
  };
}

// Constant-time comparison for the admin token
export function sameSecret(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

// What Cloudflare itself says about where our outgoing requests come from. Best effort: it can fail or be slow.
export async function egressInfo(fetcher = fetch) {
  try {
    const res = await fetcher('https://www.cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(3000) });
    const text = await res.text();
    const field = (name) => (text.match(new RegExp(`^${name}=(.*)$`, 'm')) || [])[1] || null;
    return { ip: field('ip'), colo: field('colo'), loc: field('loc') };
  } catch {
    return null;
  }
}

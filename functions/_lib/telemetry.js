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
    via: 'proxy',
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
  const count = (field, fallback = 'unknown') => events.reduce((acc, e) => ({ ...acc, [e[field] ?? fallback]: (acc[e[field] ?? fallback] || 0) + 1 }), {});
  const used = events.map((e) => e.used).filter((v) => v !== null && v !== undefined);
  const medianUsed = median(used);
  return {
    total: events.length,
    byColo: count('colo'),
    byKind: count('kind'),
    byVia: count('via', 'proxy'),
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

// ---- what browsers report -----------------------------------------------------------------------------------------
// Requests that go straight from the browser to Discogs never touch this server, so the app reports them: counts only,
// grouped by route, kind of request and outcome, plus whether the direct route is working and a coarse device type.
// Nothing here names a person, a release or a collection.

export const STAT_PREFIX = 'stat:';
const ROUTES = ['direct', 'proxy-hit', 'proxy-miss'];
const KINDS = ['collection', 'release', 'master', 'artist', 'search', 'other'];
const OUTCOMES = ['ok', 'throttled', 'failed'];
const PLATFORMS = ['ios', 'android', 'desktop', 'other'];
const MAX_COUNT = 5000;

const whole = (n) => (Number.isInteger(n) && n > 0 && n <= MAX_COUNT ? n : 0);

// Returns a clean report, or null when the body is not one we understand
export function validateReport(body) {
  if (!body || typeof body !== 'object' || typeof body.counts !== 'object' || body.counts === null) return null;
  const counts = {};
  for (const [key, value] of Object.entries(body.counts).slice(0, 60)) {
    const [route, kind, outcome] = key.split('|');
    if (ROUTES.includes(route) && KINDS.includes(kind) && OUTCOMES.includes(outcome) && whole(value)) counts[key] = value;
  }
  const throttles = (Array.isArray(body.throttles) ? body.throttles : []).slice(0, 5)
    .filter((t) => t && ROUTES.includes(t.route) && KINDS.includes(t.kind))
    .map((t) => ({ route: t.route, kind: t.kind }));
  const direct = typeof body.direct === 'string' && /^(on|off(:[\w .-]{1,20})?)$/.test(body.direct) ? body.direct : 'unknown';
  return {
    counts,
    throttles,
    direct,
    platform: PLATFORMS.includes(body.platform) ? body.platform : 'other',
    standalone: body.standalone === true,
  };
}

export const hourKey = (at) => `${STAT_PREFIX}${new Date(at).toISOString().slice(0, 13)}`;

export function mergeBucket(bucket, report, now = Date.now()) {
  const out = bucket && typeof bucket === 'object' ? bucket : { counts: {}, platforms: {}, direct: {}, reports: 0, lastAt: 0 };
  out.counts = { ...out.counts };
  for (const [key, value] of Object.entries(report.counts)) out.counts[key] = (out.counts[key] || 0) + value;
  const device = `${report.platform}${report.standalone ? '-app' : '-browser'}`;
  out.platforms = { ...out.platforms, [device]: ((out.platforms || {})[device] || 0) + 1 };
  out.direct = { ...out.direct, [report.direct]: ((out.direct || {})[report.direct] || 0) + 1 };
  out.reports = (out.reports || 0) + 1;
  out.lastAt = now;
  return out;
}

// Counts are approximate: two reports landing in the same moment can overwrite each other, which is fine for a trend
export async function recordReport(env, report, now = Date.now()) {
  if (!env?.DISCOGS_DATA) return false;
  try {
    const key = hourKey(now);
    const saved = await env.DISCOGS_DATA.get(key, 'json').catch(() => null);
    await env.DISCOGS_DATA.put(key, JSON.stringify(mergeBucket(saved, report, now)), { expirationTtl: KEEP_SECONDS });
    // A throttle the server saw itself is already in the log; only the ones it could not see (direct) are added here
    for (const t of report.throttles.filter((x) => x.route === 'direct')) {
      await recordEvent(env, { at: now, via: t.route, kind: t.kind, used: null, limit: null, retryAfter: null, colo: 'browser' });
    }
    return true;
  } catch {
    return false;
  }
}

export async function readBuckets(env, hours = 48) {
  if (!env?.DISCOGS_DATA) return [];
  const page = await env.DISCOGS_DATA.list({ prefix: STAT_PREFIX, limit: 1000 });
  const names = page.keys.map((k) => k.name).sort().slice(-hours);
  const out = [];
  for (const name of names) {
    const bucket = await env.DISCOGS_DATA.get(name, 'json').catch(() => null);
    if (bucket) out.push({ hour: name.slice(STAT_PREFIX.length), ...bucket });
  }
  return out;
}

// Totals and an hour-by-hour series, by route, kind and outcome
export function summarizeRoutes(buckets) {
  const split = (key) => key.split('|');
  const totals = {};
  const byKind = {};
  const series = buckets.map((b) => {
    const row = { hour: b.hour, requests: 0, throttled: 0, direct: 0 };
    for (const [key, n] of Object.entries(b.counts || {})) {
      const [route, kind, outcome] = split(key);
      row.requests += n;
      if (outcome === 'throttled') row.throttled += n;
      if (route === 'direct') row.direct += n;
      totals[`${route}|${outcome}`] = (totals[`${route}|${outcome}`] || 0) + n;
      byKind[`${kind}|${route}`] = (byKind[`${kind}|${route}`] || 0) + n;
    }
    return row;
  });
  const sum = (obj, field) => buckets.reduce((acc, b) => { for (const [k, v] of Object.entries(b[field] || {})) acc[k] = (acc[k] || 0) + v; return acc; }, obj);
  const direct = sum({}, 'direct');
  const lastDirectOk = [...buckets].reverse().find((b) => Object.keys(b.counts || {}).some((k) => k.startsWith('direct|') && k.endsWith('|ok')));
  return {
    totals,
    byKind,
    series,
    devices: sum({}, 'platforms'),
    directState: direct,
    lastDirectOkHour: lastDirectOk ? lastDirectOk.hour : null,
    lastReportAt: buckets.reduce((latest, b) => Math.max(latest, b.lastAt || 0), 0) || null,
  };
}

// ---- what is set up, and how loaded Discogs looks from here ------------------------------------------------------
// Booleans and non-secret settings only: never a value that is a secret
export function setupStatus(env, ttl) {
  return {
    discogsKey: Boolean(env.DISCOGS_CONSUMER_KEY),
    discogsSecret: Boolean(env.DISCOGS_CONSUMER_SECRET),
    sessionSecret: Boolean(env.SESSION_SECRET && env.SESSION_SECRET.length >= 24),
    adminToken: Boolean(env.ADMIN_TOKEN),
    sharesStore: Boolean(env.SHARES),
    dataStore: Boolean(env.DISCOGS_DATA),
    cacheSeconds: ttl,
    apiBase: env.DISCOGS_API_BASE ? 'custom' : 'discogs.com',
  };
}

// One unsigned request to Discogs' front door from this server: its budget headers say how busy this address is right now
export async function probeDiscogs(apiBase, userAgent, fetcher = fetch) {
  try {
    const res = await fetcher(`${apiBase}/`, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(3000) });
    const n = (name) => { const v = res.headers.get(name); return v === null || v === '' ? null : Number(v); };
    return { status: res.status, used: n('x-discogs-ratelimit-used'), limit: n('x-discogs-ratelimit'), remaining: n('x-discogs-ratelimit-remaining') };
  } catch {
    return null;
  }
}

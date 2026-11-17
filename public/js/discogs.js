// discogs.js - the one place that knows how this browser talks to Discogs.
//
// Requests go through our /api/discogs proxy, which holds the user's OAuth token
// in an encrypted cookie and signs the request. Page scripts never see a credential.

import { createLimiter } from './limiter.js';
import { noteSource, noteSlowdown, pathKind } from './sourcestats.js';
import { createReporter, detectPlatform, outcomeOf, buildFrom } from './reporter.js';

const state = {
  mode: 'none',
  username: '',
  configured: false, // does this server have a Discogs application set up at all?
  remaining: null, // requests left in Discogs' current rate-limit window, when the proxy reports it
  remainingAt: 0, // timestamp when remaining was last updated
};

const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(discogsState()));

export const discogsState = () => ({ ...state });
export const isDiscogsConnected = () => state.mode !== 'none';
export const onDiscogsChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// Work out how we're connected via server session.
export async function initDiscogs() {
  state.mode = 'none';
  state.username = '';

  try {
    const res = await fetch('/api/discogs/session', { credentials: 'same-origin' });
    if (res.ok) {
      const info = await res.json();
      state.configured = Boolean(info.configured);
      if (info.connected) {
        state.mode = 'oauth';
        state.username = info.username;
      }
    }
  } catch {
    // Offline or server unavailable
  }

  notify();
  return discogsState();
}

// path: a Discogs API path such as "/releases/249504" or "/users/name/collection/folders/0/releases?page=1"
// A throttle is remembered across reloads and shared between tabs, so reopening the app inside the window waits quietly
const PAUSE_KEY = 'spindex_discogs_pause';
const persist = {
  load: () => Number(localStorage.getItem(PAUSE_KEY)) || 0,
  save: (until) => localStorage.setItem(PAUSE_KEY, String(until)),
};
const limiter = createLimiter({ pace: (res) => (res?.headers?.get('x-spindex-cache') === 'HIT' ? 0 : paceMs()), persist });

// Discogs counts requests by the address they come from. Through our server that is an address shared with other
// sites, so a person's own collection (private, never cached) is read straight from their browser with a one-request
// signature from the server. Anything the shared cache can answer stays on the proxy. If the direct route fails for any
// reason, this session goes back to the proxy and carries on.
const DIRECT_PATH = /^\/users\/[^/?]+\/collection\//;
// Pages that are the same for everyone: the shared cache answers these when it can, otherwise the browser asks Discogs
const SHARED_PATH = /^\/(releases|masters|artists)\/\d+$|^\/database\/search\?barcode=/;

// Marketplace figures change by the hour and Spindex never shows them, so they are never kept (the proxy strips them
// before it caches anything; the same rule applies to what comes straight from Discogs)
export async function withoutMarketplace(res) {
  if (!res.ok) return res;
  try {
    const data = JSON.parse(await res.clone().text());
    if (!data || typeof data !== 'object') return res;
    delete data.lowest_price;
    delete data.num_for_sale;
    return new Response(JSON.stringify(data), { status: res.status, headers: res.headers });
  } catch {
    return res;
  }
}
let directOff = false;
const directRoute = new WeakSet(); // responses that came straight from Discogs, for the tally
let directOffReason = '';
export const directAvailable = () => !directOff;
export const resetDirect = () => { directOff = false; directOffReason = ''; };

async function sendDirect(path, init) {
  if (directOff || init?.method) return null;
  const shared = SHARED_PATH.test(path);
  if (!shared && !DIRECT_PATH.test(path)) return null;
  try {
    if (shared) {
      // Ask the shared cache first: an answer there costs nobody anything
      const cached = await fetch(`/api/discogs${path}${path.includes('?') ? '&' : '?'}cacheonly=1`, { credentials: 'same-origin' });
      if (cached.status !== 204) return cached;
    }
    // Signed at the last moment: the signature carries a timestamp, and the queue may have made this request wait
    const signed = await fetch(`/api/discogs/sign?path=${encodeURIComponent(path)}`, { credentials: 'same-origin' });
    if (!signed.ok) return null; // not signed in, or not something we sign: the proxy will say why
    const { url, authorization } = await signed.json();
    const res = await fetch(url, { headers: { Authorization: authorization, Accept: 'application/vnd.discogs.v2.discogs+json' } });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      directOff = true;
      directOffReason = String(res.status);
      noteSource('Discogs direct', false, `answered ${res.status}`);
      return null;
    }
    noteSource('Discogs direct', res.ok || res.status === 404 || res.status === 429, `answered ${res.status}`);
    const out = shared ? await withoutMarketplace(res) : res;
    directRoute.add(out);
    return out;
  } catch {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
    directOff = true; // blocked by the browser, a content blocker or the network
    directOffReason = 'blocked';
    noteSource('Discogs direct', false, 'blocked');
    return null;
  }
}

let buildTag = 'unknown';
if (typeof caches !== 'undefined') caches.keys().then((names) => { buildTag = buildFrom(names); }).catch(() => {});

// The app tells the server how its requests went (see reporter.js), in batches and when it goes to the background
const reporter = createReporter({
  send: (body) => {
    if (state.mode !== 'oauth' || typeof navigator === 'undefined') return;
    const payload = JSON.stringify(body);
    if (navigator.sendBeacon?.('/api/discogs/report', new Blob([payload], { type: 'application/json' }))) return;
    fetch('/api/discogs/report', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', keepalive: true }).catch(() => {});
  },
  directState: () => (directOff ? `off:${directOffReason}` : 'on'),
  build: () => buildTag,
  platform: typeof navigator !== 'undefined' ? detectPlatform(navigator.userAgent, navigator.maxTouchPoints) : 'other',
  standalone: typeof window !== 'undefined' && Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone),
});
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') reporter.flush(); });
  window.addEventListener('pagehide', () => reporter.flush());
}
export const flushReport = () => reporter.flush();

export async function send(path, init) {
  if (state.mode !== 'oauth') {
    throw new Error('Not connected to Discogs');
  }

  const answered = await sendDirect(path, init);
  const res = answered || (await fetch(`/api/discogs${path}`, { credentials: 'same-origin', ...init }));
  const fromDiscogs = directRoute.has(res);
  const route = fromDiscogs ? 'direct' : res.headers.get('x-spindex-cache') === 'HIT' ? 'proxy-hit' : 'proxy-miss';
  reporter.note(route, pathKind(path), outcomeOf(res.status));
  if (res.status === 401) {
    // The connection is no longer valid (revoked, or the cookie expired): fall back and let the UI say so
    await initDiscogs();
  }

  const remaining = res.headers.get('x-discogs-ratelimit-remaining');
  if (remaining !== null) {
    state.remaining = Number(remaining);
    state.remainingAt = Date.now();
  }
  if (res.status === 429) {
    // Which budget ran out? Discogs counts by source IP, so a low 'used' means the proxy's address is shared
    const num = (name) => { const v = res.headers.get(name); return v === null || v === '' ? null : Number(v); };
    noteSlowdown({ kind: pathKind(path), via: route, used: num('x-discogs-ratelimit-used'), limit: num('x-discogs-ratelimit'), retryAfter: num('retry-after') });
  }
  return res;
}

// Every Discogs request goes through one shared queue. priority is 'high' for anything a person is waiting on and
// 'low' for background filling, which yields to it.
export async function discogsFetch(path, init = {}, priority = 'high') {
  const res = await limiter.schedule(() => send(path, init), priority);
  noteSource('Discogs', res.ok || res.status === 404, `answered ${res.status}`);
  return res;
}

// Queue activity, for the "filling in details" indicator: fn({ pending, high, low, pausedUntil })
export const onDiscogsQueue = (fn) => limiter.subscribe(fn);

// Pause or resume low-priority background work while interactive actions (barcode scanner, album inspector) are active
export const pauseDiscogsBackground = (reason) => limiter.pauseLow(reason);
export const resumeDiscogsBackground = (reason) => limiter.resumeLow(reason);

// How long to wait between background requests. Spaced conservatively (2.5s) to leave headroom for multiple devices
// on the same network and instant interactive searches. Slows further when Discogs reports nearing the 60/min limit.
export function paceMs() {
  const isFresh = state.remainingAt && (Date.now() - state.remainingAt < 60000);
  const remaining = isFresh ? state.remaining : null;
  if (remaining === null) return 2500;
  if (remaining <= 3) return 15000;
  if (remaining <= 8) return 6000;
  if (remaining <= 15) return 4000;
  return 2500;
}

export async function disconnectDiscogs() {
  if (state.mode === 'oauth') {
    try {
      await fetch('/api/discogs/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // Cookie expires on its own eventually
    }
  }
  return initDiscogs();
}

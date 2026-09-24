// discogs.js - the one place that knows how this browser talks to Discogs.
//
//  'oauth'  the user connected through "Connect Discogs": requests go through our own /api/discogs proxy, which holds
//           their token in an encrypted cookie and signs the request. Page scripts never see a credential.
//  'token'  fallback for local use: a personal access token typed into Settings, sent straight to Discogs.
//  'none'   not connected.

import { createLimiter } from './limiter.js';
import { noteSource } from './sourcestats.js';

const API = 'https://api.discogs.com';

const state = {
  mode: 'none',
  username: '',
  configured: false, // does this server have a Discogs application set up at all?
  remaining: null, // requests left in Discogs' current rate-limit window, when the proxy reports it
};

const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(discogsState()));

export const discogsState = () => ({ ...state });
export const isDiscogsConnected = () => state.mode !== 'none';
export const onDiscogsChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function tokenCredentials() {
  const token = localStorage.getItem('discogs_token');
  const username = localStorage.getItem('discogs_username');
  return token && username ? { token, username } : null;
}

// Work out how we're connected. OAuth wins over a saved personal token.
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
    // No server functions here (plain static hosting): personal-token mode still works
  }

  if (state.mode === 'none') {
    const saved = tokenCredentials();
    if (saved) {
      state.mode = 'token';
      state.username = saved.username;
    }
  }
  notify();
  return discogsState();
}

// path: a Discogs API path such as "/releases/249504" or "/users/name/collection/folders/0/releases?page=1"
const limiter = createLimiter({ pace: (res) => (res?.headers?.get('x-spindex-cache') === 'HIT' ? 0 : paceMs()) });

async function send(path, init) {
  let res;

  if (state.mode === 'oauth') {
    res = await fetch(`/api/discogs${path}`, { credentials: 'same-origin', ...init });
    if (res.status === 401) {
      // The connection is no longer valid (revoked, or the cookie expired): fall back and let the UI say so
      await initDiscogs();
    }
  } else if (state.mode === 'token') {
    const saved = tokenCredentials();
    if (!saved) throw new Error('Not connected to Discogs');
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), 'User-Agent': 'Spindex/1.0', Authorization: `Discogs token=${saved.token}` },
    });
  } else {
    throw new Error('Not connected to Discogs');
  }

  const remaining = res.headers.get('x-discogs-ratelimit-remaining');
  if (remaining !== null) state.remaining = Number(remaining);
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

// How long to wait between background requests. Normally just over a second; slower when Discogs says we're close to
// the limit (60 a minute), which the proxy reports back on every response.
export function paceMs() {
  if (state.remaining === null) return 1100;
  if (state.remaining <= 3) return 15000;
  if (state.remaining <= 8) return 4000;
  return 1100;
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

export function saveToken(username, token) {
  localStorage.setItem('discogs_username', username);
  localStorage.setItem('discogs_token', token);
  return initDiscogs();
}

export function forgetToken() {
  localStorage.removeItem('discogs_username');
  localStorage.removeItem('discogs_token');
  return initDiscogs();
}

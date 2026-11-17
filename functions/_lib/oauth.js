// oauth.js - Discogs OAuth 1.0a helpers (PLAINTEXT signatures over HTTPS, as Discogs recommends).
// Runs in Cloudflare Pages Functions. The consumer secret must only ever exist server-side.

export const USER_AGENT = 'Spindex/1.0 +https://spindex.ryanmarch.me';

// Overridable so tests can point the flow at a local mock instead of the real Discogs
export const apiBase = (env) => (env.DISCOGS_API_BASE || 'https://api.discogs.com').replace(/\/$/, '');
export const authorizeUrl = (env) => env.DISCOGS_AUTHORIZE_URL || 'https://www.discogs.com/oauth/authorize';

export function configured(env) {
  return Boolean(env.DISCOGS_CONSUMER_KEY && env.DISCOGS_CONSUMER_SECRET && env.SESSION_SECRET && env.SESSION_SECRET.length >= 24);
}

const nonce = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// OAuth values are percent-encoded per RFC 3986
const encode = (value) => encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// PLAINTEXT signature: "<consumer secret>&<token secret>" (token secret is empty until we have one)
export function oauthHeader(env, { token = '', tokenSecret = '', callback = '', verifier = '', signatureTokenSecret = tokenSecret } = {}) {
  const params = {
    oauth_consumer_key: env.DISCOGS_CONSUMER_KEY,
    oauth_nonce: nonce(),
    oauth_signature: `${env.DISCOGS_CONSUMER_SECRET}&${signatureTokenSecret}`,
    oauth_signature_method: 'PLAINTEXT',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  };
  if (token) params.oauth_token = token;
  if (callback) params.oauth_callback = callback;
  if (verifier) params.oauth_verifier = verifier;

  // The signature contains a literal "&", exactly as Discogs' own examples show it
  return `OAuth ${Object.entries(params).map(([k, v]) => `${k}="${k === 'oauth_signature' ? v : encode(v)}"`).join(', ')}`;
}

// ---- one-request signatures ------------------------------------------------------------------------------------------
// PLAINTEXT puts the secrets themselves in the header, so it can only ever be used from here. HMAC-SHA1 (RFC 5849)
// signs the method, address, parameters, time and a one-time nonce with the secrets and reveals none of them: the
// result is good for that one request, so it can safely be handed to the browser.

const utf8 = (text) => new TextEncoder().encode(text);

export async function hmacSha1Base64(key, data) {
  const imported = await crypto.subtle.importKey('raw', utf8(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', imported, utf8(data)));
  return btoa(String.fromCharCode(...bytes));
}

// The string that gets signed: method, address without its query, and every parameter sorted and encoded
export function signatureBase(method, url, oauthParams) {
  const parsed = new URL(url);
  const pairs = [...parsed.searchParams, ...Object.entries(oauthParams)].map(([k, v]) => [encode(k), encode(v)]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const paramString = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  return `${method.toUpperCase()}&${encode(`${parsed.origin}${parsed.pathname}`)}&${encode(paramString)}`;
}

// An Authorization header for a single GET of `url`, made with the signed-in user's token
export async function signedHeader(env, session, url, { nonceValue = nonce(), timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const params = {
    oauth_consumer_key: env.DISCOGS_CONSUMER_KEY,
    oauth_nonce: nonceValue,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp),
    oauth_token: session.t,
    oauth_version: '1.0',
  };
  const signature = await hmacSha1Base64(`${encode(env.DISCOGS_CONSUMER_SECRET)}&${encode(session.s)}`, signatureBase('GET', url, params));
  return `OAuth ${Object.entries({ ...params, oauth_signature: signature }).map(([k, v]) => `${k}="${encode(v)}"`).join(', ')}`;
}

const parseForm = (text) => Object.fromEntries(new URLSearchParams(text));

// Step 1: ask Discogs for a temporary request token
export async function requestToken(env, callback) {
  const res = await fetch(`${apiBase(env)}/oauth/request_token`, {
    headers: { Authorization: oauthHeader(env, { callback }), 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) return { ok: false, status: res.status };
  const data = parseForm(await res.text());
  if (!data.oauth_token || !data.oauth_token_secret) return { ok: false, status: 502 };
  return { ok: true, token: data.oauth_token, secret: data.oauth_token_secret };
}

// Step 4: trade the request token + user's verifier for a long-lived access token.
// The OAuth spec signs with "<consumer>&<request token secret>", but Discogs' docs show "<consumer>&" for this
// step, so if the spec form is rejected we retry once with the documented form.
export async function accessToken(env, { token, secret, verifier }) {
  for (const signatureTokenSecret of [secret, '']) {
    const res = await fetch(`${apiBase(env)}/oauth/access_token`, {
      method: 'POST',
      headers: {
        Authorization: oauthHeader(env, { token, tokenSecret: secret, verifier, signatureTokenSecret }),
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    if (res.ok) {
      const data = parseForm(await res.text());
      if (data.oauth_token && data.oauth_token_secret) return { ok: true, token: data.oauth_token, secret: data.oauth_token_secret };
    }
    if (res.status !== 400 && res.status !== 401) return { ok: false, status: res.status };
  }
  return { ok: false, status: 401 };
}

// Signed request to any Discogs API path on the user's behalf
export function apiRequest(env, session, pathAndQuery, init = {}) {
  const isPost = (init.method || 'GET').toUpperCase() === 'POST';
  return fetch(`${apiBase(env)}${pathAndQuery}`, {
    ...init,
    headers: {
      Authorization: oauthHeader(env, { token: session.t, tokenSecret: session.s }),
      'User-Agent': USER_AGENT,
      Accept: 'application/vnd.discogs.v2.discogs+json',
      ...(isPost ? { 'Content-Type': 'application/json', 'Content-Length': '0' } : {}),
      ...(init.headers || {}),
    },
  });
}

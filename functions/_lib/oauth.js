// oauth.js - Discogs OAuth 1.0a helpers (PLAINTEXT signatures over HTTPS, as Discogs recommends).
// Runs in Cloudflare Pages Functions. The consumer secret must only ever exist server-side.

export const USER_AGENT = 'VinylCrate/1.0 +https://vinylcrate.ryanmarch.me';

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
export function apiRequest(env, session, pathAndQuery) {
  return fetch(`${apiBase(env)}${pathAndQuery}`, {
    headers: {
      Authorization: oauthHeader(env, { token: session.t, tokenSecret: session.s }),
      'User-Agent': USER_AGENT,
      Accept: 'application/vnd.discogs.v2.discogs+json',
    },
  });
}

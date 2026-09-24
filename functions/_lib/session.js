// session.js - encrypted cookies. The Discogs access token never reaches page scripts: it lives in an
// AES-GCM encrypted, HttpOnly cookie that only these functions can open.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_COOKIE = 'vc_session';
export const LOGIN_COOKIE = 'vc_oauth';

const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function cryptoKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode(env.SESSION_SECRET));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// data: any JSON value. ttlSeconds bakes an expiry into the payload, so a stolen cookie can't outlive it.
export async function seal(env, data, ttlSeconds) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = encoder.encode(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(env), payload));
  return toBase64Url(new Uint8Array([...iv, ...cipher]));
}

// Returns the data, or null if the cookie is missing, tampered with, from another secret, or expired
export async function open(env, value) {
  if (!value) return null;
  try {
    const bytes = fromBase64Url(value);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await cryptoKey(env), bytes.slice(12));
    const data = JSON.parse(decoder.decode(plain));
    return data.exp > Date.now() / 1000 ? data : null;
  } catch {
    return null;
  }
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

// Secure cookies are skipped on plain-http localhost, where Safari refuses them
export function cookieHeader(request, name, value, { maxAge, path = '/' } = {}) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export const clearCookie = (request, name, path = '/') => cookieHeader(request, name, '', { maxAge: 0, path });

export async function readSession(request, env) {
  return open(env, readCookie(request, SESSION_COOKIE));
}

// Only same-site relative paths may be used as a post-login destination (no open redirects)
export function safeReturnPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}

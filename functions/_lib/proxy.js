// proxy.js - what the Discogs proxy is willing to fetch. It is deliberately not an open proxy: only the read-only
// endpoints Crate uses, and only the signed-in user's own collection.

const ALLOWED_QUERY = new Set(['page', 'per_page']);

// path: everything after /api/discogs/, without a leading slash. Returns the upstream "path?query", or null.
export function allowedUpstream(path, searchParams, session) {
  const clean = String(path || '').replace(/^\/+|\/+$/g, '');
  const user = String(session?.u || '').toLowerCase();

  const ok =
    clean === 'oauth/identity' ||
    /^releases\/\d+$/.test(clean) ||
    /^masters\/\d+$/.test(clean) ||
    /^artists\/\d+$/.test(clean) ||
    (user && [`users/${user}/collection/fields`, `users/${user}/collection/folders/0/releases`].includes(clean.toLowerCase()));
  if (!ok) return null;

  // Always the signed-in user's own name, exactly as Discogs reported it
  const canonical = user && clean.toLowerCase().startsWith(`users/${user}/`) ? `users/${session.u}/${clean.split('/').slice(2).join('/')}` : clean;

  const query = new URLSearchParams();
  for (const [key, value] of searchParams) {
    if (ALLOWED_QUERY.has(key) && /^\d{1,4}$/.test(value)) query.set(key, value);
  }
  const qs = query.toString();
  return `/${canonical}${qs ? `?${qs}` : ''}`;
}

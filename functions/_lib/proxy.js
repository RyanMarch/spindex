// proxy.js - what the Discogs proxy is willing to fetch. It is deliberately not an open proxy: only the read-only
// endpoints Crate uses, and only the signed-in user's own collection.

// page/per_page are numbers; sort and sort_order only accept the values the collection endpoint understands
const ALLOWED_QUERY = {
  page: /^\d{1,4}$/,
  per_page: /^\d{1,4}$/,
  sort: /^(added|artist|title|year|label|catno|format|rating)$/,
  sort_order: /^(asc|desc)$/,
};

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
    if (ALLOWED_QUERY[key]?.test(value)) query.set(key, value);
  }
  const qs = query.toString();
  return `/${canonical}${qs ? `?${qs}` : ''}`;
}

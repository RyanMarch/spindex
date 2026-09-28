// proxy.js - what the Discogs proxy is willing to fetch. Deliberately restricted to endpoints Spindex uses.

// page/per_page are numbers; sort and sort_order only accept the values the collection endpoint understands
const ALLOWED_QUERY = {
  page: /^\d{1,4}$/,
  per_page: /^\d{1,4}$/,
  sort: /^(added|artist|title|year|label|catno|format|rating)$/,
  sort_order: /^(asc|desc)$/,
  barcode: /^[\dA-Za-z\- ]{3,40}$/,
  type: /^(release|master)$/,
};

// path: everything after /api/discogs/, without a leading slash. Returns the upstream "path?query", or null.
export function allowedUpstream(path, searchParams, session, method = 'GET') {
  const clean = String(path || '').replace(/^\/+|\/+$/g, '');
  const user = String(session?.u || '').toLowerCase();

  if (method === 'POST') {
    const parts = clean.split('/');
    if (
      parts.length === 7 &&
      parts[0].toLowerCase() === 'users' &&
      parts[1].toLowerCase() === user &&
      parts[2].toLowerCase() === 'collection' &&
      parts[3].toLowerCase() === 'folders' &&
      /^[1-9]\d*$/.test(parts[4]) &&
      parts[5].toLowerCase() === 'releases' &&
      /^\d+$/.test(parts[6])
    ) {
      return `/users/${session.u}/collection/folders/${parts[4]}/releases/${parts[6]}`;
    }
    return null;
  }

  if (method !== 'GET') return null;

  const ok =
    clean === 'oauth/identity' ||
    /^releases\/\d+$/.test(clean) ||
    /^masters\/\d+$/.test(clean) ||
    /^artists\/\d+$/.test(clean) ||
    (clean === 'database/search' && searchParams.has('barcode') && ALLOWED_QUERY.barcode.test(searchParams.get('barcode') || '')) ||
    (user && [`users/${user}/collection/fields`, `users/${user}/collection/value`, `users/${user}/collection/folders/0/releases`].includes(clean.toLowerCase()));
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

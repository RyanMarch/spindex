// http.js - tiny response helpers for the Discogs functions

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...extraHeaders },
  });
}

// A redirect that can also set cookies
export function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'private, no-store' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

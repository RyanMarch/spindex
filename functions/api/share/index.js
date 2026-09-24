// /api/share - the signed-in owner's read-only link: see it (GET), publish or refresh it (POST), remove it (DELETE).
// Needs a KV namespace bound as SHARES; without one the feature reports itself unavailable and the app hides it.
import { json } from '../../_lib/http.js';
import { readSession } from '../../_lib/session.js';
import { cleanRecords, newShareId, ownerKey, shareKey, MAX_BODY_BYTES } from '../../_lib/share.js';

const linkFor = (request, id) => `${new URL(request.url).origin}/s/${id}`;

async function current(request, env, owner) {
  const id = await env.SHARES.get(ownerKey(owner));
  if (!id) return null;
  const snapshot = await env.SHARES.get(shareKey(id), 'json');
  if (!snapshot) return null;
  return { id, url: linkFor(request, id), updatedAt: snapshot.updatedAt, count: snapshot.records?.length || 0 };
}

export async function onRequestGet({ request, env }) {
  if (!env.SHARES) return json({ available: false });
  const session = await readSession(request, env);
  if (!session?.u) return json({ available: true, signedIn: false, shared: null });
  return json({ available: true, signedIn: true, shared: await current(request, env, session.u) });
}

export async function onRequestPost({ request, env }) {
  if (!env.SHARES) return json({ error: 'Sharing is not set up on this server yet.' }, 501);
  const session = await readSession(request, env);
  if (!session?.u) return json({ error: 'Sign in with Discogs to share your crate.' }, 401);
  // Only pages of this site may publish (the cookie is SameSite=Lax; this closes the remaining gap)
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return json({ error: 'Not allowed.' }, 403);

  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY_BYTES) return json({ error: 'That collection is too large to share.' }, 413);
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: 'That collection is too large to share.' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Could not read that.' }, 400);
  }

  const records = cleanRecords(body?.records);
  if (records.length === 0) return json({ error: 'There is nothing to share yet.' }, 400);

  const existing = await env.SHARES.get(ownerKey(session.u));
  const id = existing || newShareId();
  const updatedAt = new Date().toISOString();
  await env.SHARES.put(shareKey(id), JSON.stringify({ v: 1, owner: session.u, updatedAt, records }));
  if (!existing) await env.SHARES.put(ownerKey(session.u), id);
  return json({ shared: { id, url: linkFor(request, id), updatedAt, count: records.length } });
}

export async function onRequestDelete({ request, env }) {
  if (!env.SHARES) return json({ error: 'Sharing is not set up on this server yet.' }, 501);
  const session = await readSession(request, env);
  if (!session?.u) return json({ error: 'Sign in with Discogs first.' }, 401);
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return json({ error: 'Not allowed.' }, 403);
  const id = await env.SHARES.get(ownerKey(session.u));
  if (id) {
    await env.SHARES.delete(shareKey(id));
    await env.SHARES.delete(ownerKey(session.u));
  }
  return json({ shared: null });
}

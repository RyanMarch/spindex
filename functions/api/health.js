// GET /api/health - a cheap way to confirm the functions are deployed and running
import { json } from '../_lib/http.js';

export async function onRequestGet() {
  return json({ status: 'ok', timestamp: new Date().toISOString() });
}

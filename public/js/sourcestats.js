// sourcestats.js - how each outside source has behaved since the page opened (not saved). Shown in the data health panel, so
// "why hasn't this filled in?" has an answer.
const stats = new Map();

export function noteSource(name, ok, detail = '') {
  const entry = stats.get(name) || { ok: 0, failed: 0, last: '' };
  if (ok) entry.ok++;
  else {
    entry.failed++;
    entry.last = detail;
  }
  stats.set(name, entry);
}

export const sourceSnapshot = () => [...stats].map(([name, s]) => ({ name, ...s })).sort((a, b) => a.name.localeCompare(b.name));
export const resetSourceStats = () => stats.clear();

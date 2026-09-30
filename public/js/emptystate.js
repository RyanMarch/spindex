// emptystate.js - what to say when there is nothing to show. It depends on why: no records at all, a search that found
// nothing, or a genre or filter that ruled everything out. Pure, so it is easy to test.

// Returns { title, body, actions: [{ id, label, primary? }] }, or null when there is something to show.
export function emptyState({ total, shown, query = '', genre = '', filters = '', connected = false, configured = true, syncing = false }) {
  if (shown > 0) return null;

  if (total === 0) {
    if (syncing) return { title: 'Bringing in your crate', body: 'This takes a minute the first time. Records appear as they arrive.', actions: [] };
    if (!connected) {
      return {
        title: 'Your crate is empty',
        body: 'Connect Discogs and your collection shows up here.',
        actions: [{ id: 'connect', label: 'Connect Discogs', primary: true }],
      };
    }
    return {
      title: 'Nothing in your Discogs collection yet',
      body: 'Records you add to your collection on Discogs appear here after the next check.',
      actions: [{ id: 'check', label: 'Check now', primary: true }],
    };
  }

  const asked = [];
  if (query.trim()) asked.push(`“${query.trim()}”`);
  if (genre) asked.push(genre);
  if (filters) asked.push(filters);
  const title = query.trim() && !genre && !filters ? `Nothing matches ${asked[0]}` : `Nothing matches ${asked.join(' + ')}`;
  const actions = [];
  if (query.trim() && (genre || filters)) actions.push({ id: 'reset', label: 'Clear search and filters', primary: true });
  else if (query.trim()) actions.push({ id: 'clear-search', label: 'Clear search', primary: true });
  else actions.push({ id: 'reset', label: 'Show everything', primary: true });
  return {
    title,
    body: query.trim() ? 'Try another spelling, or search by artist name.' : 'Nothing in your crate fits that combination.',
    actions,
  };
}

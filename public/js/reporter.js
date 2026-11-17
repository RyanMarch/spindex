// reporter.js - the app's own tally of how its Discogs requests went, sent to the server in small batches. Requests that
// go straight to Discogs never touch the server, so this is the only way the admin page can see them. Counts only: the
// route a request took, what kind of request it was and how it ended. No names, releases or collection contents.

// A coarse device type, so a problem on one kind of phone shows up as that
export function detectPlatform(userAgent = '', maxTouchPoints = 0) {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/.test(userAgent)) return 'desktop';
  return 'other';
}

export const outcomeOf = (status) => (status === 429 ? 'throttled' : status >= 200 && status < 300 || status === 404 ? 'ok' : 'failed');

// send(body) delivers a report; directState() says whether the direct route is on ("on" or "off:401")
// Which build of the app is running, read from the service worker's cache name ("spindex-cache-v55" is "v55")
export const buildFrom = (cacheNames = []) => {
  const versions = cacheNames.map((n) => /^spindex-cache-v(\d{1,4})$/.exec(n)).filter(Boolean).map((m) => Number(m[1]));
  return versions.length ? `v${Math.max(...versions)}` : 'unknown';
};

export function createReporter({ send, directState = () => 'unknown', build = () => 'unknown', platform = 'other', standalone = false, flushAt = 25 } = {}) {
  let counts = {};
  let throttles = [];
  let pending = 0;

  function flush() {
    if (!pending) return;
    const body = { counts, throttles, direct: directState(), build: build(), platform, standalone };
    counts = {};
    throttles = [];
    pending = 0;
    try {
      send(body);
    } catch {
      // A report that cannot be sent is simply lost
    }
  }

  // A throttle goes out at once, so it is on record even if the app is closed straight after
  function note(route, kind, outcome) {
    const key = `${route}|${kind}|${outcome}`;
    counts[key] = (counts[key] || 0) + 1;
    pending++;
    if (outcome === 'throttled' && throttles.length < 5) throttles.push({ route, kind });
    if (outcome === 'throttled' || pending >= flushAt) flush();
  }

  return { note, flush };
}

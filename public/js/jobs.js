// jobs.js - keeps each background job to one at a time. Several things can ask for the same job (opening the app, a sync
// finishing, the collection fields refreshing). Running them side by side did the same work twice, spent the Discogs
// allowance twice and counted the same records twice. A second request while one is running makes it go round once more
// when it ends, so nothing asked for in the meantime is missed.

export function createRunOnce() {
  const running = new Map();
  return function runOnce(key, job) {
    const current = running.get(key);
    if (current) {
      current.again = true;
      return current.promise;
    }
    const entry = { again: false };
    entry.promise = (async () => {
      try {
        await job();
        while (entry.again) {
          entry.again = false;
          await job();
        }
      } finally {
        running.delete(key);
      }
    })();
    running.set(key, entry);
    return entry.promise;
  };
}

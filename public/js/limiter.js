// limiter.js - one queue for every Discogs request, so sync, background enrichment and the album page share the
// 60-requests-a-minute budget instead of fighting over it. Requests run one at a time, spaced by pace(). 'high'
// requests (something the person is waiting on) jump ahead of 'low' ones (background filling). A 429 pauses the
// whole queue and retries the request, so callers rarely see one.

// Discogs' window is a rolling minute, so a short wait often clears it. When the source names a wait (Retry-After) it
// is used as given; otherwise each retry waits a little longer than the last.
const DEFAULT_WAITS_MS = [10000, 20000, 40000];
const MAX_WAIT_MS = 60000;

// attempt: 0 for the first retry. jitter: 0 to 1, spreads out devices that were throttled together.
export function retryAfterMs(res, attempt = 0, { waits = DEFAULT_WAITS_MS, jitter = 0 } = {}) {
  const seconds = Number(res?.headers?.get?.('retry-after'));
  if (seconds > 0) return Math.min(seconds * 1000, MAX_WAIT_MS);
  const base = waits[Math.min(attempt, waits.length - 1)];
  return Math.min(Math.round(base * (1 + jitter * 0.25)), MAX_WAIT_MS);
}

export function createLimiter({
  pace = () => 1100, // called with the response, so a free answer (a cache hit) can skip the wait
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  maxRetries = 3,
  throttled = (res) => res && res.status === 429, // MusicBrainz says 503
  waits = DEFAULT_WAITS_MS, // how long each retry waits when the source does not say
  random = Math.random,
  persist = null, // { load(): timestamp, save(timestamp) } keeps a pause across reloads and tabs
} = {}) {
  const queues = { high: [], low: [] };
  const listeners = new Set();
  const lowPausedReasons = new Set();
  let running = false;
  let nextAt = 0;
  let pausedUntil = 0;

  // Another tab, or this one before it was reloaded, may already have been told to wait
  function syncPause() {
    try {
      const saved = Number(persist?.load?.()) || 0;
      if (saved > pausedUntil) pausedUntil = saved;
    } catch {
      // Storage unavailable: the pause just lives in memory
    }
  }
  syncPause();

  const isLowPaused = () => lowPausedReasons.size > 0;

  function pauseLow(reason = 'default') {
    lowPausedReasons.add(reason);
    emit();
  }

  function resumeLow(reason = 'default') {
    lowPausedReasons.delete(reason);
    emit();
    pump();
  }

  function stats() {
    return {
      pending: queues.high.length + queues.low.length,
      high: queues.high.length,
      low: queues.low.length,
      pausedUntil: pausedUntil > now() ? pausedUntil : 0,
      lowPaused: isLowPaused(),
    };
  }

  function emit() {
    const snapshot = stats();
    for (const fn of listeners) fn(snapshot);
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queues.high.length || (!isLowPaused() && queues.low.length)) {
        syncPause();
        const wait = Math.max(nextAt, pausedUntil) - now();
        if (wait > 0) {
          emit();
          await sleep(wait);
        }
        const job = queues.high.shift() || (!isLowPaused() ? queues.low.shift() : null);
        if (!job) break;
        let res;
        try {
          res = await job.task();
        } catch (err) {
          nextAt = now() + pace();
          job.reject(err);
          emit();
          continue;
        }
        nextAt = now() + pace(res);
        if (throttled(res) && job.tries < maxRetries) {
          job.tries++;
          pausedUntil = now() + retryAfterMs(res, job.tries - 1, { waits, jitter: random() });
          try { persist?.save?.(pausedUntil); } catch { /* memory only */ }
          queues[job.priority].unshift(job);
        } else {
          job.resolve(res);
        }
        emit();
      }
    } finally {
      running = false;
      emit();
    }
  }

  // task: () => Promise<Response>. Resolves with its response once it has had its turn.
  function schedule(task, priority = 'high') {
    return new Promise((resolve, reject) => {
      queues[priority === 'low' ? 'low' : 'high'].push({ task, priority: priority === 'low' ? 'low' : 'high', resolve, reject, tries: 0 });
      emit();
      pump();
    });
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { schedule, subscribe, stats, pauseLow, resumeLow, isLowPaused };
}

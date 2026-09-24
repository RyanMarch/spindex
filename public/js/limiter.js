// limiter.js - one queue for every Discogs request, so sync, background enrichment and the album page share the
// 60-requests-a-minute budget instead of fighting over it. Requests run one at a time, spaced by pace(). 'high'
// requests (something the person is waiting on) jump ahead of 'low' ones (background filling). A 429 pauses the
// whole queue and retries the request, so callers rarely see one.

const DEFAULT_WAIT_MS = 30000;
const MAX_WAIT_MS = 60000;

export function retryAfterMs(res) {
  const seconds = Number(res?.headers?.get?.('retry-after'));
  return Math.min(seconds > 0 ? seconds * 1000 : DEFAULT_WAIT_MS, MAX_WAIT_MS);
}

export function createLimiter({
  pace = () => 1100,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  maxRetries = 3,
} = {}) {
  const queues = { high: [], low: [] };
  const listeners = new Set();
  let running = false;
  let nextAt = 0;
  let pausedUntil = 0;

  function stats() {
    return {
      pending: queues.high.length + queues.low.length,
      high: queues.high.length,
      low: queues.low.length,
      pausedUntil: pausedUntil > now() ? pausedUntil : 0,
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
      while (queues.high.length || queues.low.length) {
        const wait = Math.max(nextAt, pausedUntil) - now();
        if (wait > 0) {
          emit();
          await sleep(wait);
        }
        const job = queues.high.shift() || queues.low.shift();
        let res;
        try {
          res = await job.task();
        } catch (err) {
          nextAt = now() + pace();
          job.reject(err);
          emit();
          continue;
        }
        nextAt = now() + pace();
        if (res && res.status === 429 && job.tries < maxRetries) {
          job.tries++;
          pausedUntil = now() + retryAfterMs(res);
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

  return { schedule, subscribe, stats };
}

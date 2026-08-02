// Cross-device leaderboard client. This directory is the only place (besides
// the UI it feeds) that touches the network or browser storage — the
// simulation never imports it, which the architecture tests enforce. All
// platform dependencies (fetch, storage, clock) are injected so everything
// here runs under Vitest in plain Node.

const INITIALS_KEY = 'lb.initials';
const QUEUE_KEY = 'lb.queue';
const QUEUE_CAP = 10;
// Bump when the stored shape changes; a queue written by an older client is
// read through the migration in readQueue rather than crashing a newer one.
const QUEUE_VERSION = 1;
const REQUEST_TIMEOUT_MS = 10_000;
// The server returns at most its TOP_LIMIT (50) rows. Mirrored rather than
// imported — src/ must not depend on server/ — with slack so a server-side
// bump is not an instant client outage. A response past this is malformed,
// not a big leaderboard.
const MAX_SCORE_ROWS = 200;

// Statuses worth trying again. Everything else in 4xx is the server telling us
// this payload will never be accepted — retrying it forever only poisons the
// offline queue.
const RETRYABLE_STATUS = new Set([408, 425, 429]);
const isRetryableStatus = (status) => RETRYABLE_STATUS.has(status) || status >= 500;

// Backoff ladder for the queue's own retries. Boot and `online` used to be the
// ONLY things that drained the queue, so a score that failed retryably while
// the tab stayed online (a 500, a D1 outage, a timeout) sat there until the
// next reload — while the death screen said "will send later". These make
// "later" actually arrive.
//
// No jitter, deliberately: jitter decorrelates a FLEET of clients, and this is
// one tab retrying its own queue. It would also mean Math.random(), which the
// architecture test forbids anywhere under src/ — the seeded-RNG rule is not
// worth bending for a network timer.
const RETRY_BASE_MS = 10_000;
const RETRY_MAX_MS = 5 * 60_000;

// Arcade-style initials: exactly 3 characters, A-Z or 0-9. sanitize is used
// while typing (uppercase, drop everything else, clamp to 3).
export function sanitizeInitials(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3);
}

export function isValidInitials(text) {
  return /^[A-Z0-9]{3}$/.test(String(text ?? ''));
}

export function buildScorePayload({ initials, floor, version, seed, turns }) {
  return { initials, floor, version, seed: String(seed), turns };
}

// Age display for leaderboard rows. nowMs should be the *server* clock
// returned by GET /scores, so a skewed device clock can't say "-3h ago".
export function formatAge(createdAtMs, nowMs) {
  // A non-finite clock on either side used to fall all the way through to the
  // last line and render "NaNd ago". fetchScores validates the server clock
  // now, but this is exported and reachable on its own.
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) return 'unknown';
  const mins = Math.floor(Math.max(0, nowMs - createdAtMs) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Retry-After is either delta-seconds or an HTTP date; anything else is
// ignored. Returns milliseconds to wait, or 0.
function retryAfterMs(headers, nowMs) {
  const raw = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null;
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? 0 : Math.max(0, at - nowMs);
}

// `url` is the worker base URL ('' disables everything), `storage` is
// localStorage-shaped, `fetchFn` is fetch, `now` returns unix ms.
export function createLeaderboardClient({
  url,
  storage,
  fetchFn,
  now,
  timeoutMs = REQUEST_TIMEOUT_MS,
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutFn = (id) => clearTimeout(id),
}) {
  // Set when a server asks us to back off (429/503 + Retry-After); the flush
  // defers until then instead of hammering. In memory only — a backoff that
  // outlives the tab would be worse than useless.
  let nextAttemptAt = 0;
  // The single in-flight flush. Boot and every `online` event call flushQueue,
  // and two concurrent drains of the same queue would double-submit.
  let flushing = null;
  // The pending self-retry, and how long the next one waits. `retryDelay` is 0
  // whenever the queue is empty, so a fresh failure always starts the ladder
  // at RETRY_BASE_MS rather than inheriting an old backoff.
  let retryTimer = null;
  let retryDelay = 0;

  function cancelRetry() {
    if (retryTimer === null) return;
    clearTimeoutFn(retryTimer);
    retryTimer = null;
  }

  // Climb the ladder and schedule the next drain. An outstanding server-granted
  // backoff wins if it is longer — Retry-After is an instruction, not a hint.
  function armRetry() {
    const serverWait = Math.max(0, nextAttemptAt - now());
    retryDelay = retryDelay === 0 ? RETRY_BASE_MS : Math.min(retryDelay * 2, RETRY_MAX_MS);
    cancelRetry();
    retryTimer = setTimeoutFn(
      () => {
        retryTimer = null;
        flush();
      },
      Math.max(retryDelay, serverWait),
    );
  }

  function readQueue() {
    try {
      const raw = JSON.parse(storage.getItem(QUEUE_KEY) || 'null');
      if (Array.isArray(raw)) return raw; // pre-versioning shape
      if (raw && raw.v === QUEUE_VERSION && Array.isArray(raw.items)) return raw.items;
      return [];
    } catch {
      return [];
    }
  }

  function writeQueue(queue) {
    try {
      // Oldest entries drop first when over cap.
      storage.setItem(
        QUEUE_KEY,
        JSON.stringify({ v: QUEUE_VERSION, items: queue.slice(-QUEUE_CAP) }),
      );
    } catch {
      // Storage full or blocked: the score is lost, which is acceptable.
    }
  }

  // fetch with a deadline. The timeout is raced in here rather than left to
  // the request's AbortSignal, so a fetch implementation that ignores signals
  // (or a stubbed one) still can't hang the UI forever; the controller is
  // aborted too so a real request is actually cancelled.
  // `readBody`, when given, is awaited INSIDE the same deadline and its result
  // returned as `.data` — a stalled body is as much a hang as stalled headers,
  // and clearing the timer the moment headers land would leave the caller
  // waiting on res.json() with nothing watching it.
  async function request(input, init = {}, readBody = null) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        const err = new Error('request timed out');
        err.name = 'TimeoutError';
        reject(err);
      }, timeoutMs);
    });
    try {
      const work = (async () => {
        const res = await fetchFn(
          input,
          controller ? { ...init, signal: controller.signal } : init,
        );
        if (!readBody || !res.ok) return res;
        return { ...res, ok: res.ok, status: res.status, data: await readBody(res) };
      })();
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  // POST one payload. Never throws: returns { ok } or { ok: false, retryable,
  // reason } so callers can tell "try again later" from "this will never work".
  async function post(payload) {
    let res;
    try {
      res = await request(`${url}/scores`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const timedOut = err && err.name === 'TimeoutError';
      return { ok: false, retryable: true, reason: timedOut ? 'timeout' : 'network' };
    }
    if (res.ok) return { ok: true };
    const retryable = isRetryableStatus(res.status);
    // Only a retryable status may arm the backoff. A permanent 4xx is not
    // asking us to wait — it is telling us this payload will never be
    // accepted — and letting one gate the queue delayed every LATER score
    // behind a rejection that had already been dropped.
    if (retryable) {
      const wait = retryAfterMs(res.headers, now());
      // Extend only. A second, shorter Retry-After must not undo a longer
      // backoff the server already granted.
      if (wait > 0) nextAttemptAt = Math.max(nextAttemptAt, now() + wait);
    }
    return {
      ok: false,
      retryable,
      reason: `http-${res.status}`,
    };
  }

  // Scores that submit() appended while the drain was awaiting a POST. The drain
  // works from a snapshot taken before its first request, so writing that
  // snapshot back would silently discard anything queued in the meantime — a
  // death-screen submission that failed retryably mid-flush would report
  // `queued: true` and then vanish.
  //
  // This used to be computed as "everything in storage past the snapshot's
  // LENGTH", which lost exactly that score whenever the queue was already at
  // QUEUE_CAP: writeQueue drops oldest-first, so the stored array had shifted
  // left and the index pointed at or past its end, yielding []. Tracking the
  // payloads themselves is exact no matter how much capping shifted the array.
  let draining = false;
  let arrivedDuringDrain = [];

  // Drain the queue in order. A permanently-rejected entry is DISCARDED and the
  // drain continues — one bad payload used to block every later score forever.
  // A retryable failure stops the drain and keeps that entry plus the rest.
  async function drain() {
    const queue = readQueue();
    if (queue.length === 0) return { sent: 0, dropped: 0, kept: 0 };
    if (now() < nextAttemptAt) return { sent: 0, dropped: 0, kept: queue.length, deferred: true };

    let sent = 0;
    let dropped = 0;
    draining = true;
    arrivedDuringDrain = [];
    try {
      for (let i = 0; i < queue.length; i++) {
        const res = await post(queue[i]);
        if (res.ok) {
          sent += 1;
        } else if (res.retryable) {
          const kept = [...queue.slice(i), ...arrivedDuringDrain];
          writeQueue(kept);
          return { sent, dropped, kept: kept.length, reason: res.reason };
        } else {
          dropped += 1;
        }
      }
      writeQueue(arrivedDuringDrain);
      return { sent, dropped, kept: arrivedDuringDrain.length };
    } finally {
      draining = false;
    }
  }

  // Anything still queued after a drain gets another attempt scheduled; an
  // empty queue stands the ladder back down. This is the whole difference
  // between "will send later" being true and being a wish.
  function afterDrain(res) {
    if (res.kept > 0) armRetry();
    else {
      retryDelay = 0;
      cancelRetry();
    }
    return res;
  }

  // Single-flight: concurrent callers (boot + `online`, the retry timer, two
  // `online` events) share one drain instead of racing over the same queue.
  function flush() {
    if (url === '') return Promise.resolve({ sent: 0, dropped: 0, kept: 0 });
    if (!flushing) {
      flushing = drain()
        .then(afterDrain)
        .finally(() => {
          flushing = null;
        });
    }
    return flushing;
  }

  return {
    isEnabled() {
      return url !== '';
    },

    getLastInitials() {
      try {
        return storage.getItem(INITIALS_KEY) || '';
      } catch {
        return '';
      }
    },

    setLastInitials(initials) {
      try {
        storage.setItem(INITIALS_KEY, initials);
      } catch {
        // Best effort only.
      }
    },

    // Submit one score. A retryable failure (offline, timeout, 5xx) queues the
    // payload for the next boot/online event; a permanent rejection reports the
    // reason and is not queued.
    async submit(payload) {
      if (url === '') return { ok: false, reason: 'disabled' };

      // Queue the payload and make sure something will come back for it.
      const queueIt = (reason) => {
        writeQueue([...readQueue(), payload]);
        // A drain in flight is about to overwrite the queue with what IT knows
        // about; hand it this payload directly rather than relying on it
        // re-reading storage (see arrivedDuringDrain).
        if (draining) arrivedDuringDrain.push(payload);
        armRetry();
        return { ok: false, queued: true, reason };
      };

      // A server-granted backoff is still running: POSTing now would just be
      // refused again. Queue instead. This is only safe because the retry
      // timer exists — before it, honoring the backoff here would have meant
      // the score waited for a reload.
      if (now() < nextAttemptAt) return queueIt('backoff');

      const res = await post(payload);
      if (res.ok) return { ok: true };
      if (!res.retryable) return { ok: false, queued: false, reason: res.reason };
      return queueIt(res.reason);
    },

    async fetchScores() {
      if (url === '') return { ok: false, disabled: true };
      try {
        // The deadline has to cover the BODY read too. request() clears its
        // timer once headers arrive, so a response that stalls mid-body left
        // this await pending forever and the overlay sat on "Loading…" with no
        // recovery but closing it. post() never reads a body, which is why the
        // death screen was never exposed to this.
        const res = await request(`${url}/scores`, {}, (r) => r.json());
        if (!res.ok) return { ok: false, reason: `http-${res.status}` };
        // Validate the shape at the boundary. A 200 that parses is not the
        // same as a 200 that means anything — a proxy error page, a backend
        // regression, or a future API change would otherwise reach the view,
        // which calls .forEach on `scores` and formats `now` as a clock.
        const data = res.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          return { ok: false, reason: 'invalid-response' };
        }
        if (!Array.isArray(data.scores) || data.scores.length > MAX_SCORE_ROWS) {
          return { ok: false, reason: 'invalid-response' };
        }
        // The device-clock fallback that used to stand in for a missing `now`
        // is gone on purpose: our server always sends it, so its absence means
        // the response is not ours, and quietly dating other people's rows off
        // an unsynced local clock is exactly what the server clock is for.
        if (!Number.isFinite(data.now)) return { ok: false, reason: 'invalid-response' };
        return { ok: true, scores: data.scores, now: data.now };
      } catch (err) {
        return { ok: false, reason: err && err.name === 'TimeoutError' ? 'timeout' : 'network' };
      }
    },

    flushQueue: flush,

    // Drop the pending retry. The page is going away; a timer that outlives it
    // has nothing to drain and nothing to report to.
    stop() {
      cancelRetry();
    },
  };
}

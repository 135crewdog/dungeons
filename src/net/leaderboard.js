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

// Statuses worth trying again. Everything else in 4xx is the server telling us
// this payload will never be accepted — retrying it forever only poisons the
// offline queue.
const RETRYABLE_STATUS = new Set([408, 425, 429]);
const isRetryableStatus = (status) => RETRYABLE_STATUS.has(status) || status >= 500;

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
}) {
  // Set when a server asks us to back off (429/503 + Retry-After); the flush
  // defers until then instead of hammering. In memory only — a backoff that
  // outlives the tab would be worse than useless.
  let nextAttemptAt = 0;
  // The single in-flight flush. Boot and every `online` event call flushQueue,
  // and two concurrent drains of the same queue would double-submit.
  let flushing = null;

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
    const wait = retryAfterMs(res.headers, now());
    if (wait > 0) nextAttemptAt = now() + wait;
    return {
      ok: false,
      retryable: isRetryableStatus(res.status),
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
      const res = await post(payload);
      if (res.ok) return { ok: true };
      if (!res.retryable) return { ok: false, queued: false, reason: res.reason };
      writeQueue([...readQueue(), payload]);
      // A drain in flight is about to overwrite the queue with what IT knows
      // about; hand it this payload directly rather than relying on it
      // re-reading storage (see arrivedDuringDrain).
      if (draining) arrivedDuringDrain.push(payload);
      return { ok: false, queued: true, reason: res.reason };
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
        return { ok: true, scores: res.data.scores || [], now: res.data.now ?? now() };
      } catch (err) {
        return { ok: false, reason: err && err.name === 'TimeoutError' ? 'timeout' : 'network' };
      }
    },

    // Single-flight: concurrent callers (boot + `online`, or two `online`
    // events) share one drain instead of racing over the same queue.
    flushQueue() {
      if (url === '') return Promise.resolve({ sent: 0, dropped: 0, kept: 0 });
      if (!flushing) {
        flushing = drain().finally(() => {
          flushing = null;
        });
      }
      return flushing;
    },
  };
}

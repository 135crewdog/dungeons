// Cross-device leaderboard client. This directory is the only place (besides
// the UI it feeds) that touches the network or browser storage — the
// simulation never imports it, which the architecture tests enforce. All
// platform dependencies (fetch, storage, clock) are injected so everything
// here runs under Vitest in plain Node.

const INITIALS_KEY = 'lb.initials';
const QUEUE_KEY = 'lb.queue';
const QUEUE_CAP = 10;

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

// `url` is the worker base URL ('' disables everything), `storage` is
// localStorage-shaped, `fetchFn` is fetch, `now` returns unix ms.
export function createLeaderboardClient({ url, storage, fetchFn, now }) {
  function readQueue() {
    try {
      const q = JSON.parse(storage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(q) ? q : [];
    } catch {
      return [];
    }
  }

  function writeQueue(queue) {
    try {
      // Oldest entries drop first when over cap.
      storage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-QUEUE_CAP)));
    } catch {
      // Storage full or blocked: the score is lost, which is acceptable.
    }
  }

  async function post(payload) {
    const res = await fetchFn(`${url}/scores`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

    // Submit one score. On any failure (offline, server error) the payload is
    // queued locally and retried by flushQueue on the next boot/online event.
    async submit(payload) {
      if (url === '') return { ok: false };
      try {
        await post(payload);
        return { ok: true };
      } catch {
        writeQueue([...readQueue(), payload]);
        return { ok: false, queued: true };
      }
    },

    async fetchScores() {
      if (url === '') return { ok: false, disabled: true };
      try {
        const res = await fetchFn(`${url}/scores`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return { ok: true, scores: data.scores || [], now: data.now ?? now() };
      } catch {
        return { ok: false };
      }
    },

    // Drain queued submissions in order; on the first failure, keep the rest
    // (including the failed one) for next time. Deliberately no backoff.
    async flushQueue() {
      if (url === '') return;
      const queue = readQueue();
      for (let i = 0; i < queue.length; i++) {
        try {
          await post(queue[i]);
        } catch {
          writeQueue(queue.slice(i));
          return;
        }
      }
      if (queue.length > 0) writeQueue([]);
    },
  };
}

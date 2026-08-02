import { describe, it, expect } from 'vitest';
import {
  sanitizeInitials,
  isValidInitials,
  buildScorePayload,
  formatAge,
  createLeaderboardClient,
} from '../src/net/leaderboard.js';

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

function okJson(body = {}) {
  return { ok: true, json: async () => body };
}

// A failed HTTP response. `headers` is Headers-shaped (only .get is used).
function httpFail(status, headers = {}) {
  return { ok: false, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null } };
}

function makeClient({ fetchFn, url = 'https://lb.example', now, timeoutMs } = {}) {
  const storage = fakeStorage();
  const client = createLeaderboardClient({
    url,
    storage,
    fetchFn: fetchFn || (async () => okJson()),
    now: now || (() => 1_000_000),
    timeoutMs,
  });
  return { client, storage };
}

// The queue is stored versioned; tests read it through this so the envelope
// stays an implementation detail.
const queueOf = (storage) => {
  const raw = JSON.parse(storage.getItem('lb.queue'));
  return Array.isArray(raw) ? raw : raw.items;
};

const PAYLOAD = { initials: 'ABC', floor: 5, version: '0.5.0', seed: '42', turns: 300 };

describe('initials', () => {
  it('sanitizes as you type: uppercase, strip junk, clamp to 3', () => {
    expect(sanitizeInitials('abc')).toBe('ABC');
    expect(sanitizeInitials(' a-1! ')).toBe('A1');
    expect(sanitizeInitials('wxyz')).toBe('WXY');
    expect(sanitizeInitials('')).toBe('');
    expect(sanitizeInitials(null)).toBe('');
  });

  it('validates exactly 3 chars A-Z0-9', () => {
    expect(isValidInitials('ABC')).toBe(true);
    expect(isValidInitials('A1Z')).toBe(true);
    expect(isValidInitials('AB')).toBe(false);
    expect(isValidInitials('abc')).toBe(false);
    expect(isValidInitials('ABCD')).toBe(false);
  });
});

describe('buildScorePayload', () => {
  it('stringifies the seed and keeps every field', () => {
    const p = buildScorePayload({
      initials: 'ABC',
      floor: 5,
      version: '0.5.0',
      seed: 42,
      turns: 300,
    });
    expect(p).toEqual(PAYLOAD);
  });
});

describe('formatAge', () => {
  const MIN = 60_000;
  it('buckets into just now / minutes / hours / days', () => {
    expect(formatAge(1000, 1000 + 59_000)).toBe('just now');
    expect(formatAge(1000, 1000 + MIN + 1000)).toBe('1m ago');
    expect(formatAge(1000, 1000 + 59 * MIN)).toBe('59m ago');
    expect(formatAge(1000, 1000 + 60 * MIN)).toBe('1h ago');
    expect(formatAge(1000, 1000 + 25 * 60 * MIN)).toBe('1d ago');
    expect(formatAge(1000, 1000 + 3 * 24 * 60 * MIN)).toBe('3d ago');
  });

  it('never goes negative on clock skew', () => {
    expect(formatAge(5000, 1000)).toBe('just now');
  });

  // Used to fall through to the last branch and render "NaNd ago".
  it('reports a non-finite clock as unknown rather than NaN', () => {
    expect(formatAge(1000, NaN)).toBe('unknown');
    expect(formatAge(1000, Infinity)).toBe('unknown');
    expect(formatAge(NaN, 1000)).toBe('unknown');
    expect(formatAge(1000, undefined)).toBe('unknown');
  });
});

describe('client', () => {
  it('is disabled with an empty url', async () => {
    const { client } = makeClient({ url: '' });
    expect(client.isEnabled()).toBe(false);
    expect((await client.fetchScores()).disabled).toBe(true);
    expect((await client.submit(PAYLOAD)).ok).toBe(false);
  });

  it('posts a score as JSON to <url>/scores', async () => {
    const calls = [];
    const { client } = makeClient({
      fetchFn: async (url, opts) => {
        calls.push({ url, opts });
        return okJson();
      },
    });
    const res = await client.submit(PAYLOAD);
    expect(res).toEqual({ ok: true });
    expect(calls[0].url).toBe('https://lb.example/scores');
    expect(calls[0].opts.method).toBe('POST');
    expect(JSON.parse(calls[0].opts.body)).toEqual(PAYLOAD);
  });

  it('queues a retryable failed submit and reports it', async () => {
    const { client, storage } = makeClient({ fetchFn: async () => httpFail(500) });
    const res = await client.submit(PAYLOAD);
    expect(res).toEqual({ ok: false, queued: true, reason: 'http-500' });
    expect(queueOf(storage)).toEqual([PAYLOAD]);
  });

  it('does NOT queue a permanent rejection', async () => {
    // A 400 means this payload will never be accepted. Queueing it used to
    // park it at the head of the queue forever, blocking every later score.
    const { client, storage } = makeClient({ fetchFn: async () => httpFail(400) });
    const res = await client.submit(PAYLOAD);
    expect(res).toEqual({ ok: false, queued: false, reason: 'http-400' });
    expect(storage.getItem('lb.queue')).toBe(null);
  });

  it('caps the offline queue at 10, dropping the oldest', async () => {
    const { client, storage } = makeClient({
      fetchFn: async () => {
        throw new Error('offline');
      },
    });
    for (let i = 1; i <= 12; i++) await client.submit({ ...PAYLOAD, turns: i });
    const queue = queueOf(storage);
    expect(queue).toHaveLength(10);
    expect(queue[0].turns).toBe(3);
    expect(queue[9].turns).toBe(12);
  });

  it('flushQueue drains queued scores in order', async () => {
    const sent = [];
    const { client, storage } = makeClient({
      fetchFn: async (url, opts) => {
        sent.push(JSON.parse(opts.body));
        return okJson();
      },
    });
    storage.setItem(
      'lb.queue',
      JSON.stringify([
        { ...PAYLOAD, turns: 1 },
        { ...PAYLOAD, turns: 2 },
      ]),
    );
    await client.flushQueue();
    expect(sent.map((p) => p.turns)).toEqual([1, 2]);
    expect(queueOf(storage)).toEqual([]);
  });

  it('reads a pre-versioning queue written by an older client', async () => {
    // Raw-array form, as shipped before the envelope existed. This has to be
    // asserted THROUGH the client: reading it back with the test's own queueOf
    // helper only round-trips JSON and passes with readQueue's migration branch
    // deleted. Flushing it proves the client itself understood the old shape.
    const sent = [];
    const { client, storage } = makeClient({
      fetchFn: async (_url, opts) => {
        sent.push(JSON.parse(opts.body));
        return okJson();
      },
    });
    storage.setItem('lb.queue', JSON.stringify([PAYLOAD]));
    const res = await client.flushQueue();
    expect(sent).toEqual([PAYLOAD]); // the old-format entry was actually posted
    expect(res.sent).toBe(1);
    expect(queueOf(storage)).toEqual([]);
  });

  it('discards a queue written by a FUTURE client version', async () => {
    // Forward-compat: an envelope from a newer version may hold entries this
    // build cannot interpret, so it is dropped rather than posted blind.
    const sent = [];
    const { client, storage } = makeClient({
      fetchFn: async (_url, opts) => {
        sent.push(JSON.parse(opts.body));
        return okJson();
      },
    });
    storage.setItem('lb.queue', JSON.stringify({ v: 999, items: [PAYLOAD] }));
    const res = await client.flushQueue();
    expect(sent).toEqual([]); // nothing from an unreadable envelope is posted
    expect(res.sent).toBe(0);
  });

  it('flushQueue re-queues the remainder from the first RETRYABLE failure on', async () => {
    let calls = 0;
    const { client, storage } = makeClient({
      fetchFn: async () => {
        calls += 1;
        if (calls >= 2) throw new Error('offline again');
        return okJson();
      },
    });
    const items = [1, 2, 3].map((turns) => ({ ...PAYLOAD, turns }));
    storage.setItem('lb.queue', JSON.stringify(items));
    await client.flushQueue();
    expect(queueOf(storage).map((p) => p.turns)).toEqual([2, 3]);
  });

  it('drops a permanently-rejected entry and keeps draining the rest', async () => {
    // The poisoned-queue case: entry 2 can never be accepted. It must be
    // discarded, not parked at the head blocking entries 3 and 4 forever.
    const sent = [];
    const { client, storage } = makeClient({
      fetchFn: async (_url, opts) => {
        const payload = JSON.parse(opts.body);
        if (payload.turns === 2) return httpFail(400);
        sent.push(payload.turns);
        return okJson();
      },
    });
    storage.setItem(
      'lb.queue',
      JSON.stringify([1, 2, 3, 4].map((turns) => ({ ...PAYLOAD, turns }))),
    );

    const res = await client.flushQueue();

    expect(sent).toEqual([1, 3, 4]);
    expect(res).toMatchObject({ sent: 3, dropped: 1, kept: 0 });
    expect(queueOf(storage)).toEqual([]);
  });

  it('serializes concurrent flushes so nothing is submitted twice', async () => {
    // Boot calls flushQueue and so does every `online` event; two drains of the
    // same queue used to be able to interleave.
    const sent = [];
    const { client, storage } = makeClient({
      fetchFn: async (_url, opts) => {
        sent.push(JSON.parse(opts.body).turns);
        await new Promise((r) => setTimeout(r, 5));
        return okJson();
      },
    });
    storage.setItem('lb.queue', JSON.stringify([1, 2].map((turns) => ({ ...PAYLOAD, turns }))));

    const [a, b] = await Promise.all([client.flushQueue(), client.flushQueue()]);

    expect(sent).toEqual([1, 2]); // each entry sent exactly once
    expect(a).toBe(b); // both callers shared the one in-flight drain
    expect(queueOf(storage)).toEqual([]);
  });

  it('keeps a score submitted while a flush is already in flight', async () => {
    // The death screen can submit during a boot/online flush. The drain works
    // from a snapshot, so writing that snapshot back at the end would discard
    // the new entry — after submit() had already reported it as queued.
    let releaseQueued;
    const held = new Promise((r) => {
      releaseQueued = r;
    });
    const { client, storage } = makeClient({
      fetchFn: async (_url, opts) => {
        const payload = JSON.parse(opts.body);
        if (payload.turns === 1) {
          await held; // the queued entry: in flight until we say otherwise
          return okJson();
        }
        return httpFail(500); // the fresh submission: retryable, so it queues
      },
    });
    storage.setItem('lb.queue', JSON.stringify([{ ...PAYLOAD, turns: 1 }]));

    const flushing = client.flushQueue();
    const submitted = await client.submit({ ...PAYLOAD, turns: 2 });
    expect(submitted).toMatchObject({ queued: true });

    releaseQueued();
    const res = await flushing;

    expect(res).toMatchObject({ sent: 1, kept: 1 });
    expect(queueOf(storage).map((p) => p.turns)).toEqual([2]);
  });

  it('keeps that score even when the queue is already at capacity', () => {
    // Same race as above, at QUEUE_CAP. The "arrived during the drain" set used
    // to be computed as everything past the snapshot's LENGTH, but writeQueue
    // caps by dropping the OLDEST, so appending to a full queue shifts it left
    // and that index lands at/past the end — yielding nothing, and the drain
    // then wrote an empty queue over a score submit() had just promised to
    // keep. The sub-cap test above passes either way, which is how it hid.
    let releaseQueued;
    const held = new Promise((r) => {
      releaseQueued = r;
    });
    const { client, storage } = makeClient({
      fetchFn: async (_url, opts) => {
        const payload = JSON.parse(opts.body);
        if (payload.turns === 999) return httpFail(500); // the fresh one: queues
        await held; // the drain: parked until the fresh submit has landed
        return okJson();
      },
    });
    const full = Array.from({ length: 10 }, (_, i) => ({ ...PAYLOAD, turns: i + 1 }));
    storage.setItem('lb.queue', JSON.stringify(full));

    const flushing = client.flushQueue();
    return client.submit({ ...PAYLOAD, turns: 999 }).then(async (submitted) => {
      expect(submitted).toMatchObject({ queued: true });
      releaseQueued();
      const res = await flushing;
      expect(res).toMatchObject({ sent: 10, kept: 1 });
      expect(queueOf(storage).map((p) => p.turns)).toEqual([999]); // survived
    });
  });

  it('times out a fetchScores whose BODY stalls, not just its headers', async () => {
    // request() cleared its deadline as soon as headers arrived, so a response
    // that never finished its body left the leaderboard overlay on "Loading…"
    // forever. The read is inside the deadline now.
    const { client } = makeClient({
      timeoutMs: 20,
      fetchFn: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
    });
    expect(await client.fetchScores()).toEqual({ ok: false, reason: 'timeout' });
  });

  it('defers a flush while a Retry-After backoff is in force', async () => {
    let clock = 1_000_000;
    let posts = 0;
    const { client, storage } = makeClient({
      now: () => clock,
      fetchFn: async () => {
        posts += 1;
        return httpFail(429, { 'retry-after': '30' });
      },
    });
    storage.setItem('lb.queue', JSON.stringify([PAYLOAD]));

    await client.flushQueue();
    expect(posts).toBe(1);

    // Still inside the 30s window: no request goes out.
    clock += 10_000;
    expect(await client.flushQueue()).toMatchObject({ deferred: true });
    expect(posts).toBe(1);

    // Past it: the queue is tried again.
    clock += 25_000;
    await client.flushQueue();
    expect(posts).toBe(2);
    expect(queueOf(storage)).toEqual([PAYLOAD]); // still queued, still retryable
  });

  it('times out a hanging request instead of pending forever', async () => {
    const { client, storage } = makeClient({
      timeoutMs: 5,
      fetchFn: () => new Promise(() => {}), // never settles
    });
    const res = await client.submit(PAYLOAD);
    expect(res).toEqual({ ok: false, queued: true, reason: 'timeout' });
    expect(queueOf(storage)).toEqual([PAYLOAD]);

    const { client: reader } = makeClient({ timeoutMs: 5, fetchFn: () => new Promise(() => {}) });
    expect(await reader.fetchScores()).toEqual({ ok: false, reason: 'timeout' });
  });

  it('fetchScores returns rows plus the server clock, and fails soft', async () => {
    const rows = [{ initials: 'ZZZ', floor: 9, turns: 1, version: '0.5.0', created_at: 7 }];
    const { client } = makeClient({ fetchFn: async () => okJson({ scores: rows, now: 999 }) });
    expect(await client.fetchScores()).toEqual({ ok: true, scores: rows, now: 999 });

    const { client: broken } = makeClient({
      fetchFn: async () => {
        throw new Error('offline');
      },
    });
    expect((await broken.fetchScores()).ok).toBe(false);
  });

  it('remembers the last-used initials', () => {
    const { client } = makeClient({});
    expect(client.getLastInitials()).toBe('');
    client.setLastInitials('XYZ');
    expect(client.getLastInitials()).toBe('XYZ');
  });
});

// A controllable clock + timer queue, so the backoff ladder is tested by its
// real scheduling behavior rather than by waiting on wall-clock time.
function fakeScheduler(start = 1_000_000) {
  let t = start;
  let nextId = 1;
  let timers = [];
  return {
    now: () => t,
    setTimeoutFn: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, at: t + ms, fn });
      return id;
    },
    clearTimeoutFn: (id) => {
      timers = timers.filter((x) => x.id !== id);
    },
    pending: () => timers.length,
    // Delay of the next scheduled timer, relative to now.
    nextDelay: () => (timers.length === 0 ? null : Math.min(...timers.map((x) => x.at)) - t),
    // Jump to the earliest timer and run it. The callback kicks off a drain
    // without returning it; callers await client.flushQueue(), which hands
    // back that same in-flight promise (single-flight).
    fire() {
      if (timers.length === 0) return false;
      timers.sort((a, b) => a.at - b.at);
      const timer = timers.shift();
      t = timer.at;
      timer.fn();
      return true;
    },
  };
}

function schedulerClient({ fetchFn, url = 'https://lb.example' }) {
  const clock = fakeScheduler();
  const storage = fakeStorage();
  const client = createLeaderboardClient({
    url,
    storage,
    fetchFn,
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });
  return { client, storage, clock };
}

describe('queue retry scheduler', () => {
  // The headline defect: a retryable failure while the tab stays ONLINE queued
  // the score and then nothing ever came back for it. No `online` event fires,
  // so before this the only delivery was a reload.
  it('retries a queued score on its own timer, with no online event', async () => {
    let calls = 0;
    const { client, storage, clock } = schedulerClient({
      fetchFn: async () => {
        calls += 1;
        return calls === 1 ? httpFail(500) : okJson();
      },
    });

    const res = await client.submit(PAYLOAD);
    expect(res).toMatchObject({ ok: false, queued: true });
    expect(queueOf(storage)).toHaveLength(1);
    expect(clock.pending()).toBe(1);

    expect(clock.fire()).toBe(true);
    await client.flushQueue();

    expect(calls).toBe(2);
    expect(queueOf(storage)).toHaveLength(0);
    // Delivered: the ladder stands down rather than retrying an empty queue.
    expect(clock.pending()).toBe(0);
  });

  it('doubles the delay while the failure persists, and resets after success', async () => {
    let ok = false;
    const { client, clock } = schedulerClient({
      fetchFn: async () => (ok ? okJson() : httpFail(503)),
    });

    await client.submit(PAYLOAD);
    const first = clock.nextDelay();
    expect(first).toBeGreaterThan(0);

    clock.fire();
    await client.flushQueue();
    const second = clock.nextDelay();
    expect(second).toBe(first * 2);

    clock.fire();
    await client.flushQueue();
    expect(clock.nextDelay()).toBe(first * 4);

    ok = true;
    clock.fire();
    await client.flushQueue();
    expect(clock.pending()).toBe(0);

    // A brand-new failure starts the ladder over rather than inheriting the
    // delay it had climbed to.
    ok = false;
    await client.submit(PAYLOAD);
    expect(clock.nextDelay()).toBe(first);
  });

  it('caps the delay instead of climbing forever', async () => {
    const { client, clock } = schedulerClient({ fetchFn: async () => httpFail(500) });
    await client.submit(PAYLOAD);
    let previous = clock.nextDelay();
    for (let i = 0; i < 20; i++) {
      clock.fire();
      await client.flushQueue();
      const next = clock.nextDelay();
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
    expect(previous).toBe(5 * 60_000);
  });

  it('honors Retry-After over the ladder when it is longer', async () => {
    const { client, clock } = schedulerClient({
      fetchFn: async () => httpFail(429, { 'retry-after': '120' }),
    });
    await client.submit(PAYLOAD);
    // Ladder would be 10s; the server said two minutes.
    expect(clock.nextDelay()).toBe(120_000);
  });

  // Was: any non-ok status armed the backoff, so a permanent rejection — one
  // that is dropped, never retried — still delayed every later score.
  it('does not let a permanent rejection arm the backoff', async () => {
    let posts = 0;
    const { client, clock } = schedulerClient({
      fetchFn: async () => {
        posts += 1;
        return httpFail(400, { 'retry-after': '600' });
      },
    });

    const first = await client.submit(PAYLOAD);
    expect(first).toMatchObject({ ok: false, queued: false });
    expect(clock.pending()).toBe(0);

    // The next submission goes out immediately rather than deferring behind a
    // backoff the 400 should never have set.
    const second = await client.submit(PAYLOAD);
    expect(posts).toBe(2);
    expect(second.reason).not.toBe('backoff');
  });

  // Was: submit() ignored nextAttemptAt entirely and POSTed into an active
  // server-requested backoff. Safe to honor now only because the timer exists.
  it('queues instead of POSTing while a server backoff is running', async () => {
    let posts = 0;
    const { client, storage, clock } = schedulerClient({
      fetchFn: async () => {
        posts += 1;
        return httpFail(429, { 'retry-after': '120' });
      },
    });

    await client.submit(PAYLOAD);
    expect(posts).toBe(1);

    const second = await client.submit({ ...PAYLOAD, turns: 99 });
    expect(posts).toBe(1); // no second request
    expect(second).toMatchObject({ queued: true, reason: 'backoff' });
    expect(queueOf(storage)).toHaveLength(2);
    expect(clock.pending()).toBe(1);
  });

  it('stop() cancels the pending retry', async () => {
    const { client, clock } = schedulerClient({ fetchFn: async () => httpFail(500) });
    await client.submit(PAYLOAD);
    expect(clock.pending()).toBe(1);
    client.stop();
    expect(clock.pending()).toBe(0);
  });

  it('keeps one timer outstanding no matter how many flushes are requested', async () => {
    const { client, clock } = schedulerClient({ fetchFn: async () => httpFail(500) });
    await client.submit(PAYLOAD);
    await Promise.all([client.flushQueue(), client.flushQueue(), client.flushQueue()]);
    expect(clock.pending()).toBe(1);
  });
});

describe('fetchScores response validation', () => {
  const scoresFrom = async (body) => {
    const { client } = makeClient({ fetchFn: async () => okJson(body) });
    return client.fetchScores();
  };

  it('accepts a well-formed body', async () => {
    const res = await scoresFrom({ scores: [{ initials: 'ABC', floor: 2 }], now: 123 });
    expect(res).toMatchObject({ ok: true, now: 123 });
    expect(res.scores).toHaveLength(1);
  });

  // Each of these reached the view before, which calls .forEach on `scores`
  // and formats `now` as a clock.
  it.each([
    ['null body', null],
    ['array as root', [{ initials: 'ABC' }]],
    ['scores missing', { now: 1 }],
    ['scores as a number', { scores: 42, now: 1 }],
    ['scores as a string', { scores: 'nope', now: 1 }],
    ['scores as an object', { scores: { a: 1 }, now: 1 }],
    ['now missing', { scores: [] }],
    ['now not finite', { scores: [], now: 'soon' }],
    ['now NaN', { scores: [], now: NaN }],
    ['absurdly long', { scores: new Array(201).fill({}), now: 1 }],
  ])('rejects %s as an invalid response', async (_label, body) => {
    expect(await scoresFrom(body)).toEqual({ ok: false, reason: 'invalid-response' });
  });

  it('reports a rejecting json() as a failure, not a crash', async () => {
    const { client } = makeClient({
      fetchFn: async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('not json');
        },
      }),
    });
    expect((await client.fetchScores()).ok).toBe(false);
  });
});

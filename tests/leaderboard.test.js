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

  it('reads a pre-versioning queue written by an older client', () => {
    // Raw-array form, as shipped before the envelope existed.
    const { storage } = makeClient({});
    storage.setItem('lb.queue', JSON.stringify([PAYLOAD]));
    expect(queueOf(storage)).toEqual([PAYLOAD]);
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

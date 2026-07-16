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

function makeClient({ fetchFn, url = 'https://lb.example' } = {}) {
  const storage = fakeStorage();
  const client = createLeaderboardClient({
    url,
    storage,
    fetchFn: fetchFn || (async () => okJson()),
    now: () => 1_000_000,
  });
  return { client, storage };
}

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

  it('queues a failed submit and reports it', async () => {
    const { client, storage } = makeClient({ fetchFn: async () => ({ ok: false, status: 500 }) });
    const res = await client.submit(PAYLOAD);
    expect(res).toEqual({ ok: false, queued: true });
    expect(JSON.parse(storage.getItem('lb.queue'))).toEqual([PAYLOAD]);
  });

  it('caps the offline queue at 10, dropping the oldest', async () => {
    const { client, storage } = makeClient({
      fetchFn: async () => {
        throw new Error('offline');
      },
    });
    for (let i = 1; i <= 12; i++) await client.submit({ ...PAYLOAD, turns: i });
    const queue = JSON.parse(storage.getItem('lb.queue'));
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
    expect(JSON.parse(storage.getItem('lb.queue'))).toEqual([]);
  });

  it('flushQueue re-queues the remainder from the first failure on', async () => {
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
    expect(JSON.parse(storage.getItem('lb.queue')).map((p) => p.turns)).toEqual([2, 3]);
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

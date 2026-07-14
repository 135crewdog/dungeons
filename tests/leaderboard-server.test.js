import { describe, it, expect } from 'vitest';
import worker from '../server/worker.js';
import {
  validateScore,
  windowCutoff,
  WINDOW_MS,
  FLOOR_CAP,
  TURNS_CAP,
  SELECT_TOP_SQL,
} from '../server/scores.js';

// The worker uses only standard Request/Response (global in Node 18+) plus a
// D1 binding, so it is tested here with a fake DB that records every query.

function fakeDb(results = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return {
            all: async () => ({ results }),
            run: async () => ({}),
          };
        },
      };
    },
  };
}

// Each test posts from its own IP: the worker's rate-limit map is
// module-level, so a shared IP would leak state between tests.
function post(body, ip) {
  return new Request('https://lb.example/scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const VALID = { initials: 'AAA', floor: 3, turns: 120, seed: '42', version: '0.5.0' };

describe('validateScore', () => {
  it('accepts a valid payload and normalizes initials', () => {
    const res = validateScore({ ...VALID, initials: ' abc ' });
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ ...VALID, initials: 'ABC' });
  });

  it('rejects malformed initials', () => {
    for (const initials of ['AB', 'ABCD', 'a b', 'A-1', '', 12, null, undefined]) {
      expect(validateScore({ ...VALID, initials }).ok, `initials=${initials}`).toBe(false);
    }
  });

  it('bounds floor to integers 1..FLOOR_CAP', () => {
    for (const floor of [0, -1, 1.5, FLOOR_CAP + 1, '3', NaN]) {
      expect(validateScore({ ...VALID, floor }).ok, `floor=${floor}`).toBe(false);
    }
    expect(validateScore({ ...VALID, floor: 1 }).ok).toBe(true);
    expect(validateScore({ ...VALID, floor: FLOOR_CAP }).ok).toBe(true);
  });

  it('bounds turns to integers 0..TURNS_CAP', () => {
    for (const turns of [-1, 0.5, TURNS_CAP + 1, '9']) {
      expect(validateScore({ ...VALID, turns }).ok, `turns=${turns}`).toBe(false);
    }
    expect(validateScore({ ...VALID, turns: 0 }).ok).toBe(true);
  });

  it('requires a short version string and a non-empty seed', () => {
    expect(validateScore({ ...VALID, version: '' }).ok).toBe(false);
    expect(validateScore({ ...VALID, version: 'x'.repeat(21) }).ok).toBe(false);
    expect(validateScore({ ...VALID, version: 7 }).ok).toBe(false);
    expect(validateScore({ ...VALID, seed: '' }).ok).toBe(false);
    expect(validateScore({ ...VALID, seed: 'x'.repeat(65) }).ok).toBe(false);
    expect(validateScore({ ...VALID, seed: 12345 }).ok).toBe(true); // stringified
  });

  it('rejects non-object bodies', () => {
    for (const body of [null, [], 'hi', 42]) {
      expect(validateScore(body).ok).toBe(false);
    }
  });
});

describe('window and ordering', () => {
  it('cuts off exactly 30 days back', () => {
    expect(windowCutoff(WINDOW_MS + 5)).toBe(5);
    expect(WINDOW_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('ranks by floor desc, turns asc, then submission time', () => {
    expect(SELECT_TOP_SQL).toContain('ORDER BY floor DESC, turns ASC, created_at ASC');
    expect(SELECT_TOP_SQL).toContain('created_at >= ?');
  });
});

describe('worker fetch handler', () => {
  it('stores a valid score with a server timestamp', async () => {
    const db = fakeDb();
    const before = Date.now();
    const res = await worker.fetch(post({ ...VALID, initials: 'abc' }, '10.0.0.1'), { DB: db });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.calls).toHaveLength(1);
    const [initials, floor, turns, seed, version, createdAt] = db.calls[0].args;
    expect([initials, floor, turns, seed, version]).toEqual(['ABC', 3, 120, '42', '0.5.0']);
    expect(createdAt).toBeGreaterThanOrEqual(before);
  });

  it('rejects an invalid score with 400 and no insert', async () => {
    const db = fakeDb();
    const res = await worker.fetch(post({ ...VALID, floor: 0 }, '10.0.0.2'), { DB: db });
    expect(res.status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it('rejects unparseable JSON with 400', async () => {
    const res = await worker.fetch(post('{nope', '10.0.0.3'), { DB: fakeDb() });
    expect(res.status).toBe(400);
  });

  it('rejects oversized bodies with 413', async () => {
    const big = JSON.stringify({ ...VALID, seed: 'x'.repeat(600) });
    const res = await worker.fetch(post(big, '10.0.0.4'), { DB: fakeDb() });
    expect(res.status).toBe(413);
  });

  it('rate-limits the 7th rapid post from one IP', async () => {
    const db = fakeDb();
    for (let i = 0; i < 6; i++) {
      const res = await worker.fetch(post(VALID, '10.0.0.5'), { DB: db });
      expect(res.status).toBe(201);
    }
    const res = await worker.fetch(post(VALID, '10.0.0.5'), { DB: db });
    expect(res.status).toBe(429);
    expect(db.calls).toHaveLength(6);
  });

  it('serves the top scores with CORS headers and the server clock', async () => {
    const rows = [{ initials: 'ZZZ', floor: 9, turns: 50, version: '0.5.0', created_at: 1 }];
    const db = fakeDb(rows);
    const res = await worker.fetch(new Request('https://lb.example/scores'), { DB: db });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = await res.json();
    expect(body.scores).toEqual(rows);
    expect(typeof body.now).toBe('number');
    // The query binds the 30-day cutoff and the row limit.
    expect(db.calls[0].sql).toBe(SELECT_TOP_SQL);
    expect(db.calls[0].args[0]).toBeGreaterThan(0);
  });

  it('honors ALLOWED_ORIGIN and answers preflight', async () => {
    const env = { DB: fakeDb(), ALLOWED_ORIGIN: 'https://example.github.io' };
    const res = await worker.fetch(
      new Request('https://lb.example/scores', { method: 'OPTIONS' }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.github.io');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('404s unknown paths and 405s unsupported methods', async () => {
    const env = { DB: fakeDb() };
    const nope = await worker.fetch(new Request('https://lb.example/nope'), env);
    expect(nope.status).toBe(404);
    const del = await worker.fetch(
      new Request('https://lb.example/scores', { method: 'DELETE' }),
      env,
    );
    expect(del.status).toBe(405);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../server/worker.js';
import dashboardWorker from '../server/worker.dashboard.js';
import { buildDashboardWorker, DASHBOARD_PATH } from '../scripts/build-dashboard-worker.mjs';
import {
  validateScore,
  windowCutoff,
  resolveOrigin,
  byteLength,
  WINDOW_MS,
  FLOOR_CAP,
  TURNS_CAP,
  SELECT_TOP_SQL,
  INSERT_SQL,
  DUPLICATE_SQL,
  MAX_BODY_BYTES,
} from '../server/scores.js';

// The worker uses only standard Request/Response (global in Node 18+) plus a
// D1 binding, so it is tested here with a fake DB that records every query.

// `results` answers the top-scores SELECT; `dupes` answers the duplicate check
// the worker runs before an insert (empty = not a duplicate). `fail` makes
// every query throw, standing in for a D1 outage.
function fakeDb(results = [], { dupes = [], fail = false } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          const rows = sql === DUPLICATE_SQL ? dupes : results;
          return {
            all: async () => {
              if (fail) throw new Error('D1_ERROR: no such table');
              return { results: rows };
            },
            run: async () => {
              if (fail) throw new Error('D1_ERROR: no such table');
              return {};
            },
          };
        },
      };
    },
  };
}

// Inserts only — the duplicate probe shares the POST path but isn't a write.
const insertsIn = (db) => db.calls.filter((c) => c.sql === INSERT_SQL);

// ALLOWED_ORIGIN is deliberately explicit everywhere: since 0.9.5 a missing
// value is a misconfiguration, not a wildcard, and has its own test below.
const withEnv = (db, extra = {}) => ({ DB: db, ALLOWED_ORIGIN: '*', ...extra });

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

describe('resolveOrigin', () => {
  it('treats a missing or empty setting as unconfigured, never as a wildcard', () => {
    for (const value of [undefined, null, '', '   ']) {
      expect(resolveOrigin(value, 'https://a.example')).toBe(null);
    }
  });

  it('passes an explicit wildcard through without a Vary', () => {
    expect(resolveOrigin('*', 'https://a.example')).toEqual({ origin: '*', vary: false });
  });

  it('echoes a listed origin and withholds an unlisted one', () => {
    const list = 'https://a.example, https://b.example';
    expect(resolveOrigin(list, 'https://b.example')).toEqual({
      origin: 'https://b.example',
      vary: true,
    });
    expect(resolveOrigin(list, 'https://c.example')).toEqual({ origin: null, vary: true });
    expect(resolveOrigin(list, null)).toEqual({ origin: null, vary: true });
  });
});

describe('byteLength', () => {
  it('counts encoded bytes, not characters', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('🙂')).toBe(4); // .length would say 2
  });
});

describe('worker fetch handler', () => {
  it('stores a valid score with a server timestamp', async () => {
    const db = fakeDb();
    const before = Date.now();
    const res = await worker.fetch(post({ ...VALID, initials: 'abc' }, '10.0.0.1'), withEnv(db));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(insertsIn(db)).toHaveLength(1);
    const [initials, floor, turns, seed, version, createdAt] = insertsIn(db)[0].args;
    expect([initials, floor, turns, seed, version]).toEqual(['ABC', 3, 120, '42', '0.5.0']);
    expect(createdAt).toBeGreaterThanOrEqual(before);
  });

  it('rejects an invalid score with 400 and no insert', async () => {
    const db = fakeDb();
    const res = await worker.fetch(post({ ...VALID, floor: 0 }, '10.0.0.2'), withEnv(db));
    expect(res.status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it('rejects unparseable JSON with 400', async () => {
    const res = await worker.fetch(post('{nope', '10.0.0.3'), withEnv(fakeDb()));
    expect(res.status).toBe(400);
  });

  it('rejects oversized bodies with 413', async () => {
    const big = JSON.stringify({ ...VALID, seed: 'x'.repeat(600) });
    const res = await worker.fetch(post(big, '10.0.0.4'), withEnv(fakeDb()));
    expect(res.status).toBe(413);
  });

  it('rate-limits the 7th rapid post from one IP', async () => {
    const db = fakeDb();
    for (let i = 0; i < 6; i++) {
      const res = await worker.fetch(post(VALID, '10.0.0.5'), withEnv(db));
      expect(res.status).toBe(201);
    }
    const res = await worker.fetch(post(VALID, '10.0.0.5'), withEnv(db));
    expect(res.status).toBe(429);
    expect(insertsIn(db)).toHaveLength(6);
    // A rejected client needs to know how long to wait — the client's queue
    // reads this and defers its next flush instead of hammering.
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('serves the top scores with CORS headers and the server clock', async () => {
    const rows = [{ initials: 'ZZZ', floor: 9, turns: 50, version: '0.5.0', created_at: 1 }];
    const db = fakeDb(rows);
    const res = await worker.fetch(new Request('https://lb.example/scores'), withEnv(db));
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
    const env = withEnv(fakeDb(), { ALLOWED_ORIGIN: 'https://example.github.io' });
    const preflight = (origin) =>
      new Request('https://lb.example/scores', {
        method: 'OPTIONS',
        headers: origin ? { Origin: origin } : {},
      });

    const res = await worker.fetch(preflight('https://example.github.io'), env);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.github.io');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    // The answer depends on the request's Origin, so caches must not share it.
    expect(res.headers.get('Vary')).toBe('Origin');

    // An origin outside the list gets no allow header at all — the browser
    // blocks the call rather than the worker pretending it was permitted.
    const other = await worker.fetch(preflight('https://evil.example'), env);
    expect(other.headers.get('Access-Control-Allow-Origin')).toBe(null);
  });

  it('accepts a comma-separated origin allowlist', async () => {
    const env = withEnv(fakeDb(), {
      ALLOWED_ORIGIN: 'https://example.github.io, http://localhost:5173',
    });
    const res = await worker.fetch(
      new Request('https://lb.example/scores', { headers: { Origin: 'http://localhost:5173' } }),
      env,
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('fails closed when ALLOWED_ORIGIN is missing — no wildcard fallback', async () => {
    // The pre-0.9.5 code answered `*` whenever the var was unset, so a
    // misconfigured deploy was indistinguishable from a deliberate wildcard.
    for (const ALLOWED_ORIGIN of [undefined, '', '   ']) {
      const res = await worker.fetch(
        new Request('https://lb.example/scores', { headers: { Origin: 'https://any.example' } }),
        { DB: fakeDb(), ALLOWED_ORIGIN },
      );
      expect(res.status).toBe(200); // still serves; the browser is what blocks
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(null);
    }
  });

  it('refuses a duplicate resubmission of the same run', async () => {
    // The offline queue re-sends a payload whose response was lost; without
    // this the board shows the run twice.
    const db = fakeDb([], { dupes: [{ id: 1 }] });
    const res = await worker.fetch(post(VALID, '10.0.0.6'), withEnv(db));
    expect(res.status).toBe(409);
    expect(insertsIn(db)).toHaveLength(0);
    // The probe is scoped to this exact run, inside a recent window.
    const probe = db.calls.find((c) => c.sql === DUPLICATE_SQL);
    expect(probe.args.slice(0, 4)).toEqual(['AAA', 3, 120, '42']);
    expect(probe.args[4]).toBeGreaterThan(0);
  });

  it('lets a genuinely different run through', async () => {
    const db = fakeDb([], { dupes: [] });
    const res = await worker.fetch(post({ ...VALID, turns: 121 }, '10.0.0.7'), withEnv(db));
    expect(res.status).toBe(201);
    expect(insertsIn(db)).toHaveLength(1);
  });

  it('rejects a body that is oversized in BYTES, not characters', async () => {
    // MAX_BODY_BYTES is a byte budget; one emoji is four bytes and two
    // characters, so a string-length check under-counts by half.
    const seed = '🙂'.repeat(Math.ceil(MAX_BODY_BYTES / 4));
    expect(seed.length).toBeLessThan(MAX_BODY_BYTES); // would have passed before
    expect(byteLength(JSON.stringify({ ...VALID, seed }))).toBeGreaterThan(MAX_BODY_BYTES);
    const res = await worker.fetch(post({ ...VALID, seed }, '10.0.0.8'), withEnv(fakeDb()));
    expect(res.status).toBe(413);
  });

  it('requires a JSON content type', async () => {
    const req = new Request('https://lb.example/scores', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'CF-Connecting-IP': '10.0.0.9' },
      body: JSON.stringify(VALID),
    });
    expect((await worker.fetch(req, withEnv(fakeDb()))).status).toBe(415);
  });

  it('turns a storage failure into a JSON 500 with CORS, not an opaque crash', async () => {
    // An escaping rejection returns a 500 with no CORS headers, which the
    // client can only read as a network error — and would retry forever.
    const read = await worker.fetch(
      new Request('https://lb.example/scores'),
      withEnv(fakeDb([], { fail: true })),
    );
    expect(read.status).toBe(500);
    expect(read.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(read.headers.get('Cache-Control')).toBe('no-store');
    const body = await read.json();
    expect(body.error).toBe('storage unavailable');
    expect(JSON.stringify(body)).not.toMatch(/D1_ERROR|no such table/); // no internals leaked

    const write = await worker.fetch(post(VALID, '10.0.0.10'), withEnv(fakeDb([], { fail: true })));
    expect(write.status).toBe(500);
    expect(write.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('404s unknown paths and 405s unsupported methods', async () => {
    const env = withEnv(fakeDb());
    const nope = await worker.fetch(new Request('https://lb.example/nope'), env);
    expect(nope.status).toBe(404);
    const del = await worker.fetch(
      new Request('https://lb.example/scores', { method: 'DELETE' }),
      env,
    );
    expect(del.status).toBe(405);
  });

  it('caches GET /scores briefly at the edge (blunts a read/scraper flood on D1)', async () => {
    const res = await worker.fetch(new Request('https://lb.example/scores'), withEnv(fakeDb()));
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30');
  });
});

// worker.dashboard.js is the single-file copy for pasting into the Cloudflare
// dashboard, generated from scores.js + worker.js. Two guards, because they
// fail on different things: this battery catches a stale COMMITTED file
// (behavior drift), and the byte check below catches a stale GENERATOR.
describe('dashboard worker parity', () => {
  const VALID = { initials: 'AAA', floor: 3, turns: 120, seed: '42', version: '0.5.2' };
  // Each case supplies a fresh IP so the module-level rate-limit map (separate
  // per worker module) never bleeds between cases.
  const cases = [
    { name: 'valid POST', method: 'POST', body: VALID, ct: 'application/json' },
    { name: 'text/plain POST', method: 'POST', body: VALID, ct: 'text/plain' },
    { name: 'oversized body', method: 'POST', raw: 'x'.repeat(600) },
    { name: 'bad initials', method: 'POST', body: { ...VALID, initials: 'TOOLONG' } },
    { name: 'bad JSON', method: 'POST', raw: '{nope' },
    { name: 'GET', method: 'GET' },
    { name: 'OPTIONS', method: 'OPTIONS' },
    { name: 'PUT', method: 'PUT', body: {} },
    { name: 'unknown path', method: 'GET', path: '/nope' },
  ];

  async function run(w, c, ip) {
    const url = `https://lb.example${c.path || '/scores'}`;
    const headers = { 'CF-Connecting-IP': ip };
    if (c.ct) headers['content-type'] = c.ct;
    const body = c.raw ?? (c.body ? JSON.stringify(c.body) : undefined);
    const res = await w.fetch(new Request(url, { method: c.method, headers, body }), {
      // ALLOWED_ORIGIN must be SET here: without it both workers run
      // fail-closed and the compared `cors` field is null on every case, so the
      // CORS dimension of "parity" would be asserting nothing at all.
      ALLOWED_ORIGIN: '*',
      DB: fakeDb([
        { initials: 'AAA', floor: 9, turns: 1, seed: '1', version: '0.5.2', created_at: 1 },
      ]),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
      // `now` is a live server clock (Date.now()), captured microseconds apart
      // in each worker — normalize it so only logic is compared.
      if (parsed && typeof parsed.now === 'number') parsed.now = 0;
    } catch {
      parsed = text;
    }
    return {
      status: res.status,
      cors: res.headers.get('Access-Control-Allow-Origin'),
      cache: res.headers.get('Cache-Control'),
      body: parsed,
    };
  }

  it.each(cases)('responds identically to the modular worker: $name', async (c) => {
    const ip = `parity-${c.name.replace(/\s+/g, '-')}`;
    const a = await run(worker, c, `${ip}-a`);
    const b = await run(dashboardWorker, c, `${ip}-b`);
    expect(b).toEqual(a);
  });

  it('is byte-identical to a fresh generation from the modular source', () => {
    const committed = readFileSync(DASHBOARD_PATH, 'utf8');
    expect(committed, 'run: npm run build:dashboard').toBe(buildDashboardWorker());
  });

  it('carries no module plumbing the dashboard editor would choke on', () => {
    const src = readFileSync(DASHBOARD_PATH, 'utf8');
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toMatch(/^export (?!default)/m);
    expect(src).toMatch(/^export default \{/m); // still a module worker
  });
});

// The 0.9.5 hardening headline was "the rate-limit map is bounded". That was
// implemented (sweepRateLimiter + a hard cap eviction in worker.js) but never
// asserted — the 2026-08-01 audit had to verify it by hand. These drive the two
// branches through the real fetch handler, which is the only surface that can
// observe them: the map is module-level and not exported.
//
// They live last in the file because they leave the map near its cap, which is
// harmless for tests that use their own IPs but pointless to inflict earlier.
describe('rate limiter bounds (worker.js)', () => {
  const RATE_MAX_IPS = 5000; // mirrors worker.js; the module does not export it
  const okDb = () => fakeDb([]);

  afterEach(() => vi.restoreAllMocks());

  it('prunes stamps once their window has passed, so an IP is not limited forever', async () => {
    let clock = 1_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const ip = 'window-probe';
    for (let i = 0; i < 6; i++) {
      const res = await worker.fetch(post(VALID, ip), withEnv(okDb()));
      expect(res.status, `post ${i + 1} of the allowance`).toBe(201);
    }
    expect((await worker.fetch(post(VALID, ip), withEnv(okDb()))).status).toBe(429);

    clock += 60_001; // past RATE_WINDOW_MS: every stamp is now stale
    const after = await worker.fetch(post(VALID, ip), withEnv(okDb()));
    expect(after.status, 'the window reopened').toBe(201);
  });

  it('evicts old IPs rather than growing without limit', async () => {
    // Spray past the cap from unique IPs, all at one instant so nothing is
    // stale and the SWEEP cannot reclaim anything — the hard-cap eviction is
    // the only thing that can hold the bound.
    vi.spyOn(Date, 'now').mockImplementation(() => 2_000_000_000);
    const first = 'spray-0';
    expect((await worker.fetch(post(VALID, first), withEnv(okDb()))).status).toBe(201);
    for (let i = 1; i < RATE_MAX_IPS + 100; i++) {
      await worker.fetch(post(VALID, `spray-${i}`), withEnv(okDb()));
    }
    // If the map had simply grown, `spray-0` would still be holding its one
    // stamp and would 429 on its sixth further post. Evicted, it gets a fresh
    // full allowance.
    for (let i = 0; i < 6; i++) {
      const res = await worker.fetch(post(VALID, first), withEnv(okDb()));
      expect(res.status, `post ${i + 1} after eviction`).toBe(201);
    }
  });
});

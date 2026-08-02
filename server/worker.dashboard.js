// GENERATED FILE — do not edit by hand.
// Built from server/scores.js + server/worker.js by scripts/build-dashboard-worker.mjs.
// Single-file build of the leaderboard Worker, for pasting straight into the
// Cloudflare dashboard's code editor (no install, no build step, no imports).
// The modular files are the source of truth and are what the tests run against;
// regenerate this with `npm run build:dashboard` whenever they change.

// Pure leaderboard logic: payload validation, SQL strings, and the 30-day
// window math. Free of Cloudflare/D1 types so it runs under Vitest in plain
// Node; worker.js wires it to the real platform.

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TOP_LIMIT = 50;
const FLOOR_CAP = 1000;
const TURNS_CAP = 1_000_000;
const MAX_BODY_BYTES = 512;
const MAX_SEED_CHARS = 64;
const MAX_VERSION_CHARS = 20;

// A resubmission of the same run inside this window is treated as a duplicate.
// The offline queue can legitimately re-send a payload it already delivered
// (the response was lost, not the request), and it costs nothing to be casual
// about spam at the same time.
const DUP_WINDOW_MS = 10 * 60 * 1000;

const INSERT_SQL =
  'INSERT INTO scores (initials, floor, turns, seed, version, created_at) VALUES (?, ?, ?, ?, ?, ?)';

// Has this exact run already been recorded recently? Backed by idx_scores_dupe.
const DUPLICATE_SQL =
  'SELECT id FROM scores WHERE initials = ? AND floor = ? AND turns = ? AND seed = ? ' +
  'AND created_at >= ? LIMIT 1';

// Health probe: cheapest query that proves the D1 binding is attached AND the
// `scores` table exists. The count is deliberately part of the answer — a
// worker bound to the WRONG but schema-compatible database answers every other
// check identically, and a row count an operator can sanity-check against the
// live board is the difference between "responding" and "responding with our
// data". It exposes nothing the board does not already show.
const HEALTH_SQL = 'SELECT COUNT(*) AS rows FROM scores';

// Rank: deepest floor first, fewer turns breaks ties, earlier submission wins.
const SELECT_TOP_SQL =
  'SELECT initials, floor, turns, version, created_at FROM scores ' +
  'WHERE created_at >= ? ORDER BY floor DESC, turns ASC, created_at ASC LIMIT ?';

function windowCutoff(nowMs) {
  return nowMs - WINDOW_MS;
}

// Encoded size of a body, not its character count — MAX_BODY_BYTES is a byte
// budget, and one emoji is four bytes of the two that `.length` reports.
function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

// Which origins may call the API, from the ALLOWED_ORIGIN var. Returns null
// when the var is absent or empty: a MISSING configuration must not read as a
// wildcard, so the worker answers without CORS headers and a browser blocks
// the call. '*' is still honored — but only as a deliberate, configured value.
function resolveOrigin(configured, requestOrigin) {
  const value = String(configured ?? '').trim();
  if (value === '') return null;
  if (value === '*') return { origin: '*', vary: false };
  const allowed = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // The response varies by request Origin either way, so caches must not
  // reuse one origin's answer for another.
  if (requestOrigin && allowed.includes(requestOrigin)) {
    return { origin: requestOrigin, vary: true };
  }
  return { origin: null, vary: true };
}

// Validate a submitted score. Returns { ok: true, value } with a normalized
// copy (initials trimmed + uppercased, seed stringified), or { ok: false,
// error } with a human-readable reason. Never trusts field types.
function validateScore(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return fail('body must be an object');
  }
  const initials = String(body.initials ?? '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(initials)) {
    return fail('initials must be exactly 3 characters, A-Z or 0-9');
  }
  const { floor, turns, version } = body;
  if (!Number.isInteger(floor) || floor < 1 || floor > FLOOR_CAP) {
    return fail(`floor must be an integer between 1 and ${FLOOR_CAP}`);
  }
  if (!Number.isInteger(turns) || turns < 0 || turns > TURNS_CAP) {
    return fail(`turns must be an integer between 0 and ${TURNS_CAP}`);
  }
  if (typeof version !== 'string' || version.length < 1 || version.length > MAX_VERSION_CHARS) {
    return fail(`version must be a string of 1-${MAX_VERSION_CHARS} characters`);
  }
  const seed = String(body.seed ?? '');
  if (seed === '' || seed.length > MAX_SEED_CHARS) {
    return fail(`seed must be 1-${MAX_SEED_CHARS} characters`);
  }
  return { ok: true, value: { initials, floor, turns, seed, version } };
}

function fail(error) {
  return { ok: false, error };
}

// Cloudflare Worker for the cross-device leaderboard. Two endpoints backed by
// a D1 (SQLite) table — see schema.sql and README.md for deployment:
//   GET  /scores  → top 50 of the last 30 days + the server clock
//   POST /scores  → store one validated score with a server timestamp
// All validation/SQL lives in scores.js so it is unit-testable without D1.
//
// The board is an honor system by design (see CLAUDE.md): payloads are taken
// on trust. What follows is abuse blunting and correctness, not anti-cheat —
// a POST endpoint anyone can curl cannot be made cheat-proof by the server
// alone, and pretending otherwise would be worse than saying so.

const RATE_MAX_PER_WINDOW = 6;
const RATE_WINDOW_MS = 60_000;
// Best-effort abuse guard only: each Worker isolate has its own map, so the
// real global rate can exceed this. Good enough to blunt a curl loop. The map
// is bounded — expired entries are pruned and the key count is capped — so a
// long-lived isolate sprayed with unique IPs can't grow it without limit.
const RATE_MAX_IPS = 5000;
const recentPosts = new Map(); // ip → [timestamps]

function corsHeaders(env, request) {
  const resolved = resolveOrigin(env.ALLOWED_ORIGIN, request.headers.get('Origin'));
  if (!resolved) return null; // unconfigured: no CORS at all
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (resolved.origin) headers['Access-Control-Allow-Origin'] = resolved.origin;
  if (resolved.vary) headers.Vary = 'Origin';
  return headers;
}

function json(status, body, cors, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(cors || {}), ...extraHeaders },
  });
}

function sweepRateLimiter(cutoff) {
  for (const [key, stamps] of recentPosts) {
    const fresh = stamps.filter((t) => t > cutoff);
    if (fresh.length === 0) recentPosts.delete(key);
    else recentPosts.set(key, fresh);
  }
}

function rateLimited(ip, nowMs) {
  const cutoff = nowMs - RATE_WINDOW_MS;
  if (recentPosts.size >= RATE_MAX_IPS) sweepRateLimiter(cutoff);
  const fresh = (recentPosts.get(ip) || []).filter((t) => t > cutoff);
  const limited = fresh.length >= RATE_MAX_PER_WINDOW;
  if (!limited) fresh.push(nowMs);
  if (fresh.length === 0) recentPosts.delete(ip);
  else recentPosts.set(ip, fresh);
  // Even after a sweep the map can still be at the cap (all entries fresh):
  // evict the oldest-inserted key so the bound holds absolutely.
  if (recentPosts.size > RATE_MAX_IPS) {
    for (const key of recentPosts.keys()) {
      if (key !== ip) {
        recentPosts.delete(key);
        break;
      }
    }
  }
  return limited;
}

// A storage failure must not escape as an unhandled rejection: that returns an
// opaque 500 with no CORS headers, which the client can only read as a network
// error. Log a request id (never the payload) and answer in the normal shape.
function storageError(request, cors, err) {
  const id = request.headers.get('CF-Ray') || 'no-ray';
  console.error(`[leaderboard] storage failure ray=${id}: ${err && err.message}`);
  return json(500, { error: 'storage unavailable' }, cors, { 'Cache-Control': 'no-store' });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors || {} });
    }
    const url = new URL(request.url);

    // GET /health — which code is live, and is it talking to the right data?
    //
    // The old runbook's best remote check was "POST the same score twice, look
    // for 201 then 409", which proves only that some build from v0.9.5 onward
    // is deployed — and writes a junk score to find out. This answers the
    // question directly and reads nothing into the board.
    //
    // `version` comes from Cloudflare's version-metadata binding rather than a
    // var we maintain by hand: a hand-kept version string is one more thing to
    // forget on release day, which is the whole reason this release added a
    // package/lockfile version gate.
    if (url.pathname === '/health') {
      if (request.method !== 'GET') return json(405, { error: 'method not allowed' }, cors);
      const meta = env.CF_VERSION_METADATA;
      let rows = null;
      try {
        const probe = await env.DB.prepare(HEALTH_SQL).all();
        rows = probe.results && probe.results[0] ? probe.results[0].rows : null;
      } catch (err) {
        return storageError(request, cors, err);
      }
      return json(
        200,
        {
          ok: true,
          version: (meta && meta.id) || null,
          deployedAt: (meta && meta.timestamp) || null,
          db: 'ok',
          rows,
        },
        cors,
        { 'Cache-Control': 'no-store' },
      );
    }

    if (url.pathname !== '/scores') return json(404, { error: 'not found' }, cors);

    if (request.method === 'GET') {
      const now = Date.now();
      let results;
      try {
        ({ results } = await env.DB.prepare(SELECT_TOP_SQL)
          .bind(windowCutoff(now), TOP_LIMIT)
          .all());
      } catch (err) {
        return storageError(request, cors, err);
      }
      // Cache reads briefly at the edge so a refresh storm or scraper doesn't hit
      // D1 on every request; a 30-day leaderboard tolerates 30s of staleness.
      return json(200, { scores: results, now }, cors, { 'Cache-Control': 'public, max-age=30' });
    }

    if (request.method !== 'POST') return json(405, { error: 'method not allowed' }, cors);

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return json(415, { error: 'content-type must be application/json' }, cors);
    }
    // Reject on the declared size before reading anything, then on the real
    // encoded size — a client can lie about or omit Content-Length, and the
    // limit is a BYTE budget that string length would under-count.
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return json(413, { error: 'payload too large' }, cors);
    }
    // Reading the body can itself reject — an aborted upload, a truncated
    // stream, a bad content-encoding. Unguarded, that escaped the handler as
    // an opaque platform 500 with NO CORS headers, which the client can only
    // read as a network error: the exact failure mode storageError exists to
    // prevent, one step earlier in the request.
    let text;
    try {
      text = await request.text();
    } catch {
      return json(400, { error: 'malformed request body' }, cors, { 'Cache-Control': 'no-store' });
    }
    if (byteLength(text) > MAX_BODY_BYTES) {
      return json(413, { error: 'payload too large' }, cors);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip, Date.now())) {
      return json(429, { error: 'too many submissions' }, cors, {
        'Retry-After': String(RATE_WINDOW_MS / 1000),
      });
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'invalid JSON' }, cors);
    }
    const checked = validateScore(body);
    if (!checked.ok) return json(400, { error: checked.error }, cors);

    const s = checked.value;
    const now = Date.now();
    try {
      // The offline queue can re-send a score whose response was lost; without
      // this the board would show the same run twice.
      const dupe = await env.DB.prepare(DUPLICATE_SQL)
        .bind(s.initials, s.floor, s.turns, s.seed, now - DUP_WINDOW_MS)
        .all();
      if (dupe.results && dupe.results.length > 0) {
        return json(409, { error: 'duplicate submission' }, cors);
      }
      await env.DB.prepare(INSERT_SQL)
        .bind(s.initials, s.floor, s.turns, s.seed, s.version, now)
        .run();
    } catch (err) {
      return storageError(request, cors, err);
    }
    return json(201, { ok: true }, cors);
  },
};

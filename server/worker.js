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

import {
  validateScore,
  windowCutoff,
  byteLength,
  resolveOrigin,
  INSERT_SQL,
  SELECT_TOP_SQL,
  DUPLICATE_SQL,
  DUP_WINDOW_MS,
  TOP_LIMIT,
  MAX_BODY_BYTES,
} from './scores.js';

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
    const text = await request.text();
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

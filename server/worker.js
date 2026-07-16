// Cloudflare Worker for the cross-device leaderboard. Two endpoints backed by
// a D1 (SQLite) table — see schema.sql and README.md for deployment:
//   GET  /scores  → top 50 of the last 30 days + the server clock
//   POST /scores  → store one validated score with a server timestamp
// All validation/SQL lives in scores.js so it is unit-testable without D1.

import {
  validateScore,
  windowCutoff,
  INSERT_SQL,
  SELECT_TOP_SQL,
  TOP_LIMIT,
  MAX_BODY_BYTES,
} from './scores.js';

const RATE_MAX_PER_WINDOW = 6;
const RATE_WINDOW_MS = 60_000;
// Best-effort abuse guard only: each Worker isolate has its own map, so the
// real global rate can exceed this. Good enough to blunt a curl loop.
const recentPosts = new Map(); // ip → [timestamps]

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(status, body, env, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(env), ...extraHeaders },
  });
}

function rateLimited(ip, nowMs) {
  const fresh = (recentPosts.get(ip) || []).filter((t) => t > nowMs - RATE_WINDOW_MS);
  const limited = fresh.length >= RATE_MAX_PER_WINDOW;
  if (!limited) fresh.push(nowMs);
  recentPosts.set(ip, fresh);
  return limited;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    const url = new URL(request.url);
    if (url.pathname !== '/scores') return json(404, { error: 'not found' }, env);

    if (request.method === 'GET') {
      const now = Date.now();
      const { results } = await env.DB.prepare(SELECT_TOP_SQL)
        .bind(windowCutoff(now), TOP_LIMIT)
        .all();
      // Cache reads briefly at the edge so a refresh storm or scraper doesn't hit
      // D1 on every request; a 30-day leaderboard tolerates 30s of staleness.
      return json(200, { scores: results, now }, env, { 'Cache-Control': 'public, max-age=30' });
    }

    if (request.method !== 'POST') return json(405, { error: 'method not allowed' }, env);

    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { error: 'payload too large' }, env);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip, Date.now())) return json(429, { error: 'too many submissions' }, env);

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'invalid JSON' }, env);
    }
    const checked = validateScore(body);
    if (!checked.ok) return json(400, { error: checked.error }, env);

    const s = checked.value;
    await env.DB.prepare(INSERT_SQL)
      .bind(s.initials, s.floor, s.turns, s.seed, s.version, Date.now())
      .run();
    return json(201, { ok: true }, env);
  },
};

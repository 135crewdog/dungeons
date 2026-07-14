// Single-file build of the leaderboard Worker, for pasting straight into the
// Cloudflare dashboard's code editor (no install, no build step, no imports).
// It is functionally identical to worker.js + scores.js combined. Those
// modular files remain the source of truth and are what the tests run against;
// keep this file in sync if the logic changes.

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TOP_LIMIT = 50;
const FLOOR_CAP = 1000;
const TURNS_CAP = 1_000_000;
const MAX_BODY_BYTES = 512;
const MAX_SEED_CHARS = 64;
const MAX_VERSION_CHARS = 20;

const INSERT_SQL =
  'INSERT INTO scores (initials, floor, turns, seed, version, created_at) VALUES (?, ?, ?, ?, ?, ?)';
const SELECT_TOP_SQL =
  'SELECT initials, floor, turns, version, created_at FROM scores ' +
  'WHERE created_at >= ? ORDER BY floor DESC, turns ASC, created_at ASC LIMIT ?';

function windowCutoff(nowMs) {
  return nowMs - WINDOW_MS;
}

function validateScore(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body must be an object' };
  }
  const initials = String(body.initials ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(initials)) {
    return { ok: false, error: 'initials must be exactly 3 characters, A-Z or 0-9' };
  }
  const { floor, turns, version } = body;
  if (!Number.isInteger(floor) || floor < 1 || floor > FLOOR_CAP) {
    return { ok: false, error: `floor must be an integer between 1 and ${FLOOR_CAP}` };
  }
  if (!Number.isInteger(turns) || turns < 0 || turns > TURNS_CAP) {
    return { ok: false, error: `turns must be an integer between 0 and ${TURNS_CAP}` };
  }
  if (typeof version !== 'string' || version.length < 1 || version.length > MAX_VERSION_CHARS) {
    return { ok: false, error: `version must be a string of 1-${MAX_VERSION_CHARS} characters` };
  }
  const seed = String(body.seed ?? '');
  if (seed === '' || seed.length > MAX_SEED_CHARS) {
    return { ok: false, error: `seed must be 1-${MAX_SEED_CHARS} characters` };
  }
  return { ok: true, value: { initials, floor, turns, seed, version } };
}

const RATE_MAX_PER_WINDOW = 6;
const RATE_WINDOW_MS = 60_000;
const recentPosts = new Map();

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(status, body, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(env) },
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
      return json(200, { scores: results, now }, env);
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

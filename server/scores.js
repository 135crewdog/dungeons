// Pure leaderboard logic: payload validation, SQL strings, and the 30-day
// window math. Free of Cloudflare/D1 types so it runs under Vitest in plain
// Node; worker.js wires it to the real platform.

export const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const TOP_LIMIT = 50;
export const FLOOR_CAP = 1000;
export const TURNS_CAP = 1_000_000;
export const MAX_BODY_BYTES = 512;
export const MAX_SEED_CHARS = 64;
export const MAX_VERSION_CHARS = 20;

// A resubmission of the same run inside this window is treated as a duplicate.
// The offline queue can legitimately re-send a payload it already delivered
// (the response was lost, not the request), and it costs nothing to be casual
// about spam at the same time.
export const DUP_WINDOW_MS = 10 * 60 * 1000;

export const INSERT_SQL =
  'INSERT INTO scores (initials, floor, turns, seed, version, created_at) VALUES (?, ?, ?, ?, ?, ?)';

// Has this exact run already been recorded recently? Backed by idx_scores_dupe.
export const DUPLICATE_SQL =
  'SELECT id FROM scores WHERE initials = ? AND floor = ? AND turns = ? AND seed = ? ' +
  'AND created_at >= ? LIMIT 1';

// Rank: deepest floor first, fewer turns breaks ties, earlier submission wins.
export const SELECT_TOP_SQL =
  'SELECT initials, floor, turns, version, created_at FROM scores ' +
  'WHERE created_at >= ? ORDER BY floor DESC, turns ASC, created_at ASC LIMIT ?';

export function windowCutoff(nowMs) {
  return nowMs - WINDOW_MS;
}

// Encoded size of a body, not its character count — MAX_BODY_BYTES is a byte
// budget, and one emoji is four bytes of the two that `.length` reports.
export function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

// Which origins may call the API, from the ALLOWED_ORIGIN var. Returns null
// when the var is absent or empty: a MISSING configuration must not read as a
// wildcard, so the worker answers without CORS headers and a browser blocks
// the call. '*' is still honored — but only as a deliberate, configured value.
export function resolveOrigin(configured, requestOrigin) {
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
export function validateScore(body) {
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

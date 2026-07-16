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

export const INSERT_SQL =
  'INSERT INTO scores (initials, floor, turns, seed, version, created_at) VALUES (?, ?, ?, ?, ?, ?)';

// Rank: deepest floor first, fewer turns breaks ties, earlier submission wins.
export const SELECT_TOP_SQL =
  'SELECT initials, floor, turns, version, created_at FROM scores ' +
  'WHERE created_at >= ? ORDER BY floor DESC, turns ASC, created_at ASC LIMIT ?';

export function windowCutoff(nowMs) {
  return nowMs - WINDOW_MS;
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

// The single seedable RNG abstraction. All procedural generation and combat
// randomness must route through this — never Math.random() in gameplay code.
//
// The generator is mulberry32: tiny, fast, and fully deterministic given a
// seed. State is a plain `{ s }` object so it can live directly on the game
// state and be reproduced exactly. Functions take that state object and advance
// it in place, keeping the game state the single source of truth.

// Fold any input (number or string) into a 32-bit unsigned integer seed.
export function hashSeed(input) {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input >>> 0;
  }
  const str = String(input);
  let h = 2166136261 >>> 0; // FNV-1a offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Create an RNG state object from a seed (number or string).
export function createRng(seed) {
  const s = hashSeed(seed);
  return { seed: s, s };
}

// Normalize a seed that may have arrived as text (e.g. a URL ?seed= param). A
// canonical integer string becomes a Number so it folds through hashSeed's
// idempotent number path — this is what lets a copied decimal seed reproduce its
// run (hashSeed(number) === number, but hashSeed("123") FNV-hashes the text).
// Non-integer text (custom string seeds) passes through unchanged.
export function coerceSeed(input) {
  if (typeof input !== 'string') return input;
  const trimmed = input.trim();
  const n = Number(trimmed);
  return Number.isInteger(n) && String(n) === trimmed ? n : input;
}

// Advance the generator and return a float in [0, 1).
export function nextFloat(rng) {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Integer in [min, max] inclusive.
export function nextInt(rng, min, max) {
  if (max < min) [min, max] = [max, min];
  return min + Math.floor(nextFloat(rng) * (max - min + 1));
}

// True with probability p (0..1).
export function chance(rng, p) {
  return nextFloat(rng) < p;
}

// Uniformly pick one element of a non-empty array.
export function pick(rng, arr) {
  return arr[Math.floor(nextFloat(rng) * arr.length)];
}

// Fisher–Yates shuffle in place, returning the same array.
export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat(rng) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

import { describe, it, expect } from 'vitest';
import {
  hashSeed,
  createRng,
  coerceSeed,
  nextFloat,
  nextInt,
  chance,
  pick,
  shuffle,
} from '../src/core/rng.js';

describe('rng', () => {
  it('is deterministic: same seed produces the same sequence', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 100 }, () => nextFloat(a));
    const seqB = Array.from({ length: 100 }, () => nextFloat(b));
    expect(seqA).toEqual(seqB);
  });

  it('matches the locked mulberry32 sequence (saved seeds stay reproducible)', () => {
    // Pin the exact output so an accidental change to the generator — which would
    // silently invalidate every shared/logged seed — fails loudly here.
    const r = createRng(12345);
    expect(Array.from({ length: 5 }, () => nextFloat(r))).toEqual([
      0.9797282677609473,
      0.3067522644996643,
      0.484205421525985,
      0.817934412509203,
      0.5094283693470061,
    ]);
  });

  it('different seeds diverge', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 20 }, () => nextFloat(a));
    const seqB = Array.from({ length: 20 }, () => nextFloat(b));
    expect(seqA).not.toEqual(seqB);
  });

  it('hashSeed folds strings and numbers to uint32', () => {
    expect(hashSeed(42)).toBe(42);
    const h = hashSeed('hello');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    // Stable across calls.
    expect(hashSeed('hello')).toBe(h);
  });

  it('string and numeric seeds both drive reproducible runs', () => {
    const a = createRng('seed-string');
    const b = createRng('seed-string');
    expect(nextFloat(a)).toBe(nextFloat(b));
  });

  it('coerceSeed turns a numeric string into the equivalent number seed', () => {
    // A run started from number N logs/copies "N"; reopening ?seed=N must
    // reproduce it. coerceSeed makes the string fold to the same 32-bit seed.
    const n = 2847619203;
    expect(coerceSeed(String(n))).toBe(n);
    expect(createRng(coerceSeed(String(n))).seed).toBe(createRng(n).seed);
    // Whitespace tolerated; leading zeros / non-canonical forms stay strings.
    expect(coerceSeed('  42  ')).toBe(42);
    expect(coerceSeed('007')).toBe('007');
    expect(coerceSeed('1e3')).toBe('1e3');
    expect(coerceSeed('seed-string')).toBe('seed-string');
    expect(coerceSeed(42)).toBe(42);
  });

  it('nextFloat stays in [0, 1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = nextFloat(r);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt respects inclusive bounds', () => {
    const r = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = nextInt(r, 3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('chance(0.75) lands near 75% over many trials', () => {
    const r = createRng(2024);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (chance(r, 0.75)) hits++;
    const rate = hits / n;
    expect(rate).toBeGreaterThan(0.73);
    expect(rate).toBeLessThan(0.77);
  });

  it('pick returns an element of the array deterministically', () => {
    const arr = ['a', 'b', 'c', 'd'];
    const a = createRng(5);
    const b = createRng(5);
    const picksA = Array.from({ length: 10 }, () => pick(a, arr));
    const picksB = Array.from({ length: 10 }, () => pick(b, arr));
    expect(picksA).toEqual(picksB);
    for (const p of picksA) expect(arr).toContain(p);
  });

  it('shuffle is a deterministic permutation', () => {
    const base = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffle(createRng(11), [...base]);
    const b = shuffle(createRng(11), [...base]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(base);
  });
});

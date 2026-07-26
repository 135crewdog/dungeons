import { describe, it, expect } from 'vitest';
import { bandOf, secretPlan, ringFor } from '../src/world/secrets.js';
import { createGame, descend } from '../src/core/gameState.js';
import { SECRET_BAND_FLOORS, RING_TYPES } from '../src/core/constants.js';

describe('the per-band secret plan (pure, seed-derived)', () => {
  const seeds = [1, 2, 3, 42, 1337, 987654321, 'custom-text-seed'];

  it('maps floors to bands', () => {
    expect(bandOf(1)).toBe(0);
    expect(bandOf(5)).toBe(0);
    expect(bandOf(6)).toBe(1);
    expect(bandOf(10)).toBe(1);
    expect(bandOf(11)).toBe(2);
  });

  it('is deterministic and never draws from any shared RNG', () => {
    for (const seed of seeds) {
      for (let band = 0; band < 10; band++) {
        expect(secretPlan(seed, band)).toEqual(secretPlan(seed, band));
      }
    }
  });

  it('puts the key strictly before the chest, both inside the band', () => {
    for (const seed of seeds) {
      for (let band = 0; band < 10; band++) {
        const { keyFloor, chestFloor } = secretPlan(seed, band);
        const first = band * SECRET_BAND_FLOORS + 1;
        const last = first + SECRET_BAND_FLOORS - 1;
        expect(keyFloor).toBeGreaterThanOrEqual(first);
        expect(chestFloor).toBeLessThanOrEqual(last);
        expect(keyFloor).toBeLessThan(chestFloor);
      }
    }
  });

  it('grants all four rings across the first four bands, then wraps', () => {
    for (const seed of seeds) {
      const cycle = [0, 1, 2, 3].map((b) => ringFor(seed, b));
      expect(new Set(cycle).size).toBe(RING_TYPES.length);
      expect(ringFor(seed, 4)).toBe(cycle[0]);
      expect(ringFor(seed, 7)).toBe(cycle[3]);
    }
  });

  it('different seeds produce different plans (spot check)', () => {
    const plans = seeds.map((s) => JSON.stringify([0, 1, 2].map((b) => secretPlan(s, b))));
    expect(new Set(plans).size).toBeGreaterThan(1);
  });
});

describe('secret spawning across a real run', () => {
  // Walk a real game down 10 floors (two bands) and check that exactly the
  // planned floors carry the hidden key and the locked chest.
  it.each([11, 22, 33])('seed %i: one key and one locked chest per band, on plan', (seed) => {
    const state = createGame(seed);
    const found = new Map(); // floor → { keys, chests, ring }
    for (let floor = 1; floor <= 2 * SECRET_BAND_FLOORS; floor++) {
      if (floor > 1) descend(state);
      expect(state.floor).toBe(floor);
      const keys = state.items.filter((it) => it.type === 'key');
      const chests = state.items.filter((it) => it.type === 'lockedChest');
      found.set(floor, { keys, chests });
    }
    for (const band of [0, 1]) {
      const plan = secretPlan(state.seed, band);
      for (
        let floor = band * SECRET_BAND_FLOORS + 1;
        floor <= (band + 1) * SECRET_BAND_FLOORS;
        floor++
      ) {
        const { keys, chests } = found.get(floor);
        expect(keys).toHaveLength(floor === plan.keyFloor ? 1 : 0);
        expect(chests).toHaveLength(floor === plan.chestFloor ? 1 : 0);
        if (floor === plan.keyFloor) expect(keys[0].hidden).toBe(true);
        if (floor === plan.chestFloor) expect(chests[0].ring).toBe(plan.ring);
      }
    }
  });

  it('the same seed spawns secrets on the same tiles', () => {
    const a = createGame(77);
    const b = createGame(77);
    for (let floor = 1; floor <= SECRET_BAND_FLOORS; floor++) {
      if (floor > 1) {
        descend(a);
        descend(b);
      }
      const secretsOf = (s) =>
        s.items
          .filter((it) => it.type === 'key' || it.type === 'lockedChest')
          .map(({ type, x, y, ring }) => ({ type, x, y, ring }));
      expect(secretsOf(a)).toEqual(secretsOf(b));
    }
  });
});

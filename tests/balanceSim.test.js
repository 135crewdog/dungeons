// Smoke tests for the headless balance simulator (scripts/balance). These
// guard that the bots can actually drive the engine (no crashes, no stalls on
// healthy seeds) and that a batch is exactly reproducible from its seeds —
// they intentionally assert nothing about difficulty numbers, which are free
// to move with tuning.

import { describe, it, expect } from 'vitest';
import { runGame } from '../scripts/balance/runner.js';

const SEEDS = [7, 1234, 987654];
const POLICIES = ['thorough', 'rusher'];

describe('balance simulator', () => {
  for (const policy of POLICIES) {
    it(`${policy} bot plays seeded runs to a verdict without stalling`, () => {
      for (const seed of SEEDS) {
        const result = runGame(seed, policy, { maxFloor: 3 });
        expect(result.stalled).toBe(false);
        expect(result.maxFloorReached).toBeGreaterThanOrEqual(1);
        // Every run ends decisively: dead on some floor, or alive past maxFloor.
        if (result.deathFloor === null) {
          expect(result.cleared).toBe(true);
          expect(result.maxFloorReached).toBe(4);
        } else {
          expect(result.deathFloor).toBeGreaterThanOrEqual(1);
          expect(result.deathFloor).toBeLessThanOrEqual(3);
          expect(result.deathCause).toBeTruthy();
        }
        // One descent snapshot per cleared floor, in order.
        expect(result.descents.map((d) => d.floor)).toEqual(
          Array.from({ length: result.maxFloorReached - 1 }, (_, i) => i + 1),
        );
      }
    });
  }

  it('is deterministic: the same seed replays to an identical result', () => {
    for (const policy of POLICIES) {
      const a = runGame(42, policy, { maxFloor: 3 });
      const b = runGame(42, policy, { maxFloor: 3 });
      expect(b).toEqual(a);
    }
  });

  it('rejects unknown policies', () => {
    expect(() => runGame(1, 'nope')).toThrow(/unknown policy/);
  });
});

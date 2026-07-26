// The deterministic "secrets" plan. Each SECRET_BAND_FLOORS-floor band (1–5,
// 6–10, …) hides one key on an earlier floor and one locked chest — holding a
// magic ring — on a strictly later floor of the same band. Everything here is
// a pure function of (seed, band): draws come from a locally derived RNG,
// never the main stream, so any floor's plan is computable in isolation
// regardless of visit order, and adding secrets never shifts another floor's
// generation draws. Spawn placement (WHERE on the floor) stays on the main
// RNG like every other spawn; only WHICH floors and WHICH ring live here.

import { createRng, nextInt, shuffle } from '../core/rng.js';
import { SECRET_BAND_FLOORS, RING_TYPES } from '../core/constants.js';

// Which band a floor belongs to (0-based: floors 1–5 → band 0).
export function bandOf(floorNumber) {
  return Math.floor((floorNumber - 1) / SECRET_BAND_FLOORS);
}

// A band's plan: { keyFloor, chestFloor, ring }, with keyFloor strictly
// earlier so the natural descent meets the key first (missing it means
// climbing back up — floors persist). The chest may share the boss floor.
export function secretPlan(seed, band) {
  const rng = createRng(`${seed}:secrets:${band}`);
  const first = band * SECRET_BAND_FLOORS + 1;
  const keyOffset = nextInt(rng, 0, SECRET_BAND_FLOORS - 2);
  const chestOffset = nextInt(rng, keyOffset + 1, SECRET_BAND_FLOORS - 1);
  return {
    keyFloor: first + keyOffset,
    chestFloor: first + chestOffset,
    ring: ringFor(seed, band),
  };
}

// One seed-shuffled cycle through the ring pool: bands 0–3 each grant a
// distinct ring (no duplicates per run's first cycle); deeper bands wrap.
// Re-granting a permanent ring is a no-op; a wrapped Survival ring re-arms a
// spent one.
export function ringFor(seed, band) {
  const rng = createRng(`${seed}:rings`);
  const order = shuffle(rng, [...RING_TYPES]);
  return order[band % order.length];
}

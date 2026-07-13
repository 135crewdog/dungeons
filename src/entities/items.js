import {
  POTION_HEAL,
  CHEST_EFFECT,
  CHEST_STRENGTH_BONUS,
  CHEST_ARMOR_BONUS,
  CHEST_HEALTH_BONUS,
  CHEST_TRAP_DIE,
  CHEST_TABLE,
} from '../core/constants.js';
import { nextInt } from '../core/rng.js';

// Factory for a health potion at integer tile coordinates. Items live in
// state.items (they are not turn-taking entities). The id is assigned by the
// caller from the shared allocator so it is unique across the run.
export function createPotion(x, y) {
  return { id: 0, type: 'potion', x, y, heal: POTION_HEAL };
}

// Factory for a treasure chest. Contents are rolled once here, at spawn, from
// the CHEST_TABLE d100 thresholds — so what a chest holds is fixed by the
// run's seed and survives floor snapshots.
export function createChest(rng, x, y) {
  const roll = nextInt(rng, 1, 100);
  let effect;
  let amount;
  if (roll <= CHEST_TABLE.strength) {
    effect = CHEST_EFFECT.STRENGTH;
    amount = CHEST_STRENGTH_BONUS;
  } else if (roll <= CHEST_TABLE.armor) {
    effect = CHEST_EFFECT.ARMOR;
    amount = CHEST_ARMOR_BONUS;
  } else if (roll <= CHEST_TABLE.health) {
    effect = CHEST_EFFECT.HEALTH;
    amount = CHEST_HEALTH_BONUS;
  } else {
    effect = CHEST_EFFECT.TRAP;
    amount = nextInt(rng, 1, CHEST_TRAP_DIE); // a trap hits like a goblin: 1..4
  }
  return { id: 0, type: 'chest', x, y, effect, amount };
}

// The chest a boss drops where it dies: always a bonus, never a trap —
// 1/3 strength, 1/3 armor, 1/3 health. Same item shape as createChest.
export function createBossChest(rng, x, y) {
  const roll = nextInt(rng, 1, 3);
  let effect;
  let amount;
  if (roll === 1) {
    effect = CHEST_EFFECT.STRENGTH;
    amount = CHEST_STRENGTH_BONUS;
  } else if (roll === 2) {
    effect = CHEST_EFFECT.ARMOR;
    amount = CHEST_ARMOR_BONUS;
  } else {
    effect = CHEST_EFFECT.HEALTH;
    amount = CHEST_HEALTH_BONUS;
  }
  return { id: 0, type: 'chest', x, y, effect, amount };
}

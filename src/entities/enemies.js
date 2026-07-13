import { ENEMY_TYPES } from '../core/constants.js';

// The enemy archetypes that can be spawned. Two types: goblins are weak and
// quick; skeletons hit with the same die but are fragile and move at half
// speed.
export const SPAWNABLE_ENEMIES = Object.values(ENEMY_TYPES);

// Factory for an enemy of a given archetype at integer tile coordinates.
// `aggro` starts false: enemies hold until they see the player. Once aggroed,
// `lastSeen` remembers the last tile the player was seen on and
// `lostSightTurns` counts how long it has been since — used to give up the
// chase when the player breaks line of sight (e.g. flees through a door).
// `moveCooldown` starts at 0 so the first move after aggro is immediate; a
// moveEvery-N enemy then rests N-1 turns between steps.
export function createEnemy(type, x, y) {
  return {
    id: 0,
    kind: type.kind,
    glyph: type.glyph,
    x,
    y,
    hp: type.maxHp,
    maxHp: type.maxHp,
    damageDie: type.damageDie,
    damageMult: type.damageMult ?? 1,
    moveEvery: type.moveEvery ?? 1,
    moveCooldown: 0,
    aggro: false,
    lastSeen: null,
    lostSightTurns: 0,
  };
}

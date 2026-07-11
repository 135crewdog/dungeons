import { ENEMY_TYPES } from '../core/constants.js';

// The enemy archetypes that can be spawned. Two types with distinct HP/damage:
// goblins are weak and numerous-feeling; skeletons hit harder and take more.
export const SPAWNABLE_ENEMIES = Object.values(ENEMY_TYPES);

// Factory for an enemy of a given archetype at integer tile coordinates.
// `aggro` starts false: enemies hold until they see the player. Once aggroed,
// `lastSeen` remembers the last tile the player was seen on and
// `lostSightTurns` counts how long it has been since — used to give up the
// chase when the player breaks line of sight (e.g. flees through a door).
export function createEnemy(type, x, y) {
  return {
    id: 0,
    kind: type.kind,
    glyph: type.glyph,
    x,
    y,
    hp: type.maxHp,
    maxHp: type.maxHp,
    damage: type.damage,
    aggro: false,
    lastSeen: null,
    lostSightTurns: 0,
  };
}

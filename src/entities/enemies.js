import {
  ENEMY_TYPES,
  BOSS_FLOOR_INTERVAL,
  BOSS_HP_PER_TIER,
  SCALE_DMG_EVERY_FLOORS,
  SCALE_HP_EVERY_FLOORS,
} from '../core/constants.js';

// The enemy archetypes the random pool can spawn: goblins are weak and quick;
// skeletons hit with the same die but are fragile and move at half speed. The
// boss is deliberately NOT in this list — it is placed by spawnBoss on boss
// floors only.
export const SPAWNABLE_ENEMIES = [ENEMY_TYPES.goblin, ENEMY_TYPES.skeleton];

// Factory for an enemy of a given archetype at integer tile coordinates,
// depth-scaled by the floor it spawns on (stats live on the instance, so
// cached floors keep their numbers). Regular enemies drip extra max HP and a
// flat damage bonus with depth; bosses trade the HP drip for their own tier
// curve (more HP and a bigger damage multiplier per lair).
// `aggro` starts false: enemies hold until they see the player. Once aggroed,
// `lastSeen` remembers the last tile the player was seen on and
// `lostSightTurns` counts how long it has been since — used to give up the
// chase when the player breaks line of sight (e.g. flees through a door).
// `moveCooldown` starts at 0 so the first move after aggro is immediate; a
// moveEvery-N enemy then rests N-1 turns between steps.
export function createEnemy(type, x, y, floorNumber = 1) {
  const isBoss = type.kind === 'boss';
  const tier = Math.max(1, Math.floor(floorNumber / BOSS_FLOOR_INTERVAL));
  const maxHp = isBoss
    ? type.maxHp + BOSS_HP_PER_TIER * (tier - 1)
    : type.maxHp + Math.floor((floorNumber - 1) / SCALE_HP_EVERY_FLOORS);
  return {
    id: 0,
    kind: type.kind,
    glyph: type.glyph,
    x,
    y,
    hp: maxHp,
    maxHp,
    damageDie: type.damageDie,
    damageMult: isBoss ? tier + 1 : (type.damageMult ?? 1),
    // Bosses scale damage through their multiplier alone; stacking the flat
    // drip on top made deep lairs pierce armor twice over.
    dmgBonus: isBoss ? 0 : Math.floor((floorNumber - 1) / SCALE_DMG_EVERY_FLOORS),
    moveEvery: type.moveEvery ?? 1,
    moveCooldown: 0,
    aggro: false,
    lastSeen: null,
    lostSightTurns: 0,
  };
}

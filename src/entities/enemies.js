import {
  ENEMY_TYPES,
  BOSS_FLOOR_INTERVAL,
  BOSS_HP_PER_TIER,
  BOSS_DICE,
  ENEMY_DIE_LADDER,
  DIE_LADDER_EVERY_FLOORS,
  SCALE_HP_EVERY_FLOORS,
} from '../core/constants.js';

// The enemy archetypes the random pool can spawn: goblins are weak and quick;
// skeletons hit with the same die but are fragile and move at half speed. The
// boss is deliberately NOT in this list — it is placed by spawnBoss on boss
// floors only.
export const SPAWNABLE_ENEMIES = [ENEMY_TYPES.goblin, ENEMY_TYPES.skeleton];

// Factory for an enemy of a given archetype at integer tile coordinates,
// depth-scaled by the floor it spawns on (stats live on the instance, so
// cached floors keep their numbers). Deeper monsters roll bigger damage dice:
// regulars climb ENEMY_DIE_LADDER one rung per DIE_LADDER_EVERY_FLOORS and
// drip extra max HP; bosses pick their die from BOSS_DICE by lair tier and
// gain BOSS_HP_PER_TIER max HP per tier instead.
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
  const rung = Math.min(
    Math.floor((floorNumber - 1) / DIE_LADDER_EVERY_FLOORS),
    ENEMY_DIE_LADDER.length - 1,
  );
  const attackDie = isBoss
    ? BOSS_DICE[Math.min(tier - 1, BOSS_DICE.length - 1)]
    : ENEMY_DIE_LADDER[rung];
  return {
    id: 0,
    kind: type.kind,
    glyph: type.glyph,
    x,
    y,
    hp: maxHp,
    maxHp,
    attackDie,
    moveEvery: type.moveEvery ?? 1,
    moveCooldown: 0,
    aggro: false,
    lastSeen: null,
    lostSightTurns: 0,
  };
}

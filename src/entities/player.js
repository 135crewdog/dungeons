import { PLAYER_MAX_HP, PLAYER_ATTACK_DIE } from '../core/constants.js';

// Factory for the player entity. Position is in integer tile coordinates.
// The id is assigned by the state's entity allocator when added.
// Combat stat block: d8 damage die; skill, strength, and armor start at 0
// and grow only through treasure chests.
export function createPlayer(x, y) {
  return {
    id: 0,
    kind: 'player',
    x,
    y,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    attackDie: PLAYER_ATTACK_DIE,
    skill: 0, // chest bonuses: +1 on every to-hit roll per stack
    strength: 0, // chest bonuses: extra damage dealt per stack
    armor: 0, // chest bonuses: damage taken reduced per stack (hits floor at 1)
    glyph: '@',
  };
}

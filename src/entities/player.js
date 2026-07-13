import { PLAYER_MAX_HP, PLAYER_DAMAGE_DIE, PLAYER_DAMAGE_BONUS } from '../core/constants.js';

// Factory for the player entity. Position is in integer tile coordinates.
// The id is assigned by the state's entity allocator when added.
// Damage is a d4+2 stat block, resolved by the same combat path as enemy
// dice: base roll × mult, plus dmgBonus, plus strength.
export function createPlayer(x, y) {
  return {
    id: 0,
    kind: 'player',
    x,
    y,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    damageDie: PLAYER_DAMAGE_DIE,
    dmgBonus: PLAYER_DAMAGE_BONUS,
    strength: 0, // chest bonuses: extra damage dealt per stack
    armor: 0, // chest bonuses: damage taken reduced per stack (hits floor at 1)
    glyph: '@',
  };
}

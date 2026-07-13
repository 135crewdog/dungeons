import { PLAYER_MAX_HP, PLAYER_DAMAGE } from '../core/constants.js';

// Factory for the player entity. Position is in integer tile coordinates.
// The id is assigned by the state's entity allocator when added.
export function createPlayer(x, y) {
  return {
    id: 0,
    kind: 'player',
    x,
    y,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    damage: PLAYER_DAMAGE,
    strength: 0, // chest bonuses: extra damage dealt per stack
    armor: 0, // chest bonuses: damage taken reduced per stack (hits floor at 1)
    glyph: '@',
  };
}

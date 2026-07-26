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
    keys: 0, // secret keys held (Phase 7); interchangeable, spent on locked chests
    // Phase-7 rings: passive, auto-worn on pickup, kept for the whole run.
    // The player object survives floor swaps by reference (it is excluded from
    // floor snapshots), so these persist across floors; restart() recreates
    // the player and wipes them. Survival is one-shot: cleared when it fires.
    ringSight: false,
    ringShadow: false,
    ringSpeed: false,
    ringSurvival: false,
    glyph: '@',
  };
}

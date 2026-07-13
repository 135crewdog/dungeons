// Shared gameplay constants and enums. Leaf module: imports nothing.
// The simulation deals only in integer tile coordinates; TILE_SIZE is the sole
// pixel-related value here and is consumed exclusively by the renderer.

export const TILE_SIZE = 16;

// Tile type ids. Stored as bytes in the map's Uint8Array.
export const TILE = Object.freeze({
  WALL: 0,
  FLOOR: 1,
  DOOR: 2,
  STAIRS_DOWN: 3,
  STAIRS_UP: 4,
});

// The player entity always uses this fixed id. Enemies/items on every floor
// start allocating at 2, so the carried-over player never collides with them
// and stays the lowest id (drawn first, and its slot is free when a cached
// floor is restored).
export const PLAYER_ID = 1;

// Combat: two visible rolls, identical rules for every combatant.
// 1) To-hit — roll a d20: a natural 1 always misses; otherwise the attack
//    lands if roll + skill >= HIT_THRESHOLD (6 → 75% base, +5% per skill
//    point, capped at 95% by the natural-1 rule).
// 2) Damage — roll the attacker's damage die + strength − target armor
//    (minimum 1; see mitigatedDamage).
export const HIT_DIE = 20;
export const HIT_THRESHOLD = 6;

// Player. Rolls a d8 for damage; skill/strength/armor start at 0 and grow
// only through treasure chests.
export const PLAYER_MAX_HP = 20;
export const PLAYER_ATTACK_DIE = 8;

// Enemy types. Goblin is the baseline; skeletons are "about half a goblin" —
// fragile AND slow (`moveEvery: 2` = one tile every 2 turns; attacks are never
// slowed) — but roll the same damage die. The die itself comes from the depth
// ladder below and is stamped at spawn. `glyph` is a presentation hint; the
// renderer's tileStyle owns the final glyph/color.
export const ENEMY_TYPES = Object.freeze({
  goblin: { kind: 'goblin', glyph: 'g', maxHp: 6, moveEvery: 1 },
  skeleton: { kind: 'skeleton', glyph: 's', maxHp: 3, moveEvery: 2 },
  // The level boss: one guards the down-stairs on every BOSS_FLOOR_INTERVAL-th
  // floor (never the random pool). maxHp is the tier-1 (floor 5) value; its
  // damage die comes from BOSS_DICE. Simulator-tuned (npm run balance): a hard
  // peak, but no longer the majority of all deaths. Same rules as everyone.
  boss: { kind: 'boss', glyph: 'B', maxHp: 24, moveEvery: 1 },
});

// Every Nth floor spawns a boss in the room with the down-stairs.
export const BOSS_FLOOR_INTERVAL = 5;

// Depth scaling: deeper monsters roll bigger dice. Regular enemies climb the
// ladder one rung per DIE_LADDER_EVERY_FLOORS (floors 1-3: d4, 4-6: d6, ...,
// clamped at the last rung) and gain +1 max HP per SCALE_HP_EVERY_FLOORS.
// Bosses skip the ladder: each lair tier (floor/5) picks from BOSS_DICE
// (floor 5: d10, floor 10: d12, floor 15+: d20) and adds BOSS_HP_PER_TIER
// max HP. The ladder replaces the old flat damage bonus with the same means
// (d4+n ≡ d(4+2n) in expectation) and more variance.
export const ENEMY_DIE_LADDER = Object.freeze([4, 6, 8, 10]);
export const DIE_LADDER_EVERY_FLOORS = 4;
export const BOSS_DICE = Object.freeze([8, 12, 20]);
export const SCALE_HP_EVERY_FLOORS = 2;
export const BOSS_HP_PER_TIER = 12;

// Items.
export const POTION_HEAL = 8;

// Treasure chests. Contents are decided at spawn time (deterministic per seed)
// and stored on the item. Bonuses stack across a run; the trap hits like a
// goblin and respects armor (same rule as enemy attacks).
export const CHEST_EFFECT = Object.freeze({
  STRENGTH: 'strength',
  SKILL: 'skill',
  ARMOR: 'armor',
  HEALTH: 'health',
  TRAP: 'trap',
});
export const CHEST_STRENGTH_BONUS = 1; // +1 damage dealt per stack
export const CHEST_SKILL_BONUS = 1; // +1 on every to-hit roll per stack (+5% accuracy)
export const CHEST_ARMOR_BONUS = 1; // -1 damage taken per stack
export const CHEST_HEALTH_BONUS = 4; // +4 max HP, and refill to full
export const CHEST_TRAP_DIE = 4; // rolled 1..die at spawn — a trap hits like a floor-1 goblin

// Chest contents table: cumulative d100 thresholds rolled at spawn. Four stat
// builds (damage, accuracy, defense, pool) plus the trap share that makes
// greedy chest-opening a gamble.
export const CHEST_TABLE = Object.freeze({
  strength: 25, // 1-25   → +strength (25%)
  skill: 45, //    26-45  → +skill    (20%)
  armor: 70, //    46-70  → +armor    (25%)
  health: 90, //   71-90  → +max HP   (20%)
  // 91-100 → trap (10%)
});

// Map + generation.
export const MAP_WIDTH = 72;
export const MAP_HEIGHT = 44;
export const MIN_ROOMS = 7;
export const MAX_ROOMS = 12;
export const MIN_ROOM_SIZE = 4;
export const MAX_ROOM_SIZE = 10;

// Population per floor (mildly RNG-varied). Enemy count grows with depth:
// +1 per ENEMY_COUNT_EVERY_FLOORS floors of descent, capped at
// ENEMY_COUNT_CAP. The spawn mix also drifts toward goblins (the tougher
// archetype) as the player descends.
export const MIN_ENEMIES = 5;
export const MAX_ENEMIES = 8;
export const ENEMY_COUNT_EVERY_FLOORS = 3;
export const ENEMY_COUNT_CAP = 12;
export const GOBLIN_WEIGHT_BASE = 0.5; // goblin share of the mix on floor 1
export const GOBLIN_WEIGHT_PER_FLOOR = 0.03; // added per floor below the first
export const GOBLIN_WEIGHT_MAX = 0.8;
export const MIN_POTIONS = 1;
export const MAX_POTIONS = 3;
export const MIN_CHESTS = 1;
export const MAX_CHESTS = 2;

// Field of view: unbounded line of sight within walls (classic). A large radius
// stands in for "unbounded" while bounding worst-case work on open maps.
export const FOV_RADIUS = 40;

// How many turns an aggroed enemy keeps hunting after it loses line of sight
// before giving up (it heads to the last place it saw the player first).
export const DEAGGRO_TURNS = 6;

// Auto-walk pacing: ms between stored-path steps so movement is visible.
export const STEP_DELAY_MS = 90;

// 8-directional movement vectors, in a fixed deterministic order
// (N, NE, E, SE, S, SW, W, NW).
export const DIRS8 = Object.freeze([
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
]);

// Cardinal-only vectors (used where diagonals are not wanted).
export const DIRS4 = Object.freeze([
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
]);

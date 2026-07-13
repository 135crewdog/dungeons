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

// Combat.
export const HIT_CHANCE = 0.75;

// Player.
export const PLAYER_MAX_HP = 20;
export const PLAYER_DAMAGE = 4;

// Enemy damage is a die rolled fresh on every landed hit (through the seeded
// RNG, after the hit roll succeeds) — the player's damage stays flat.
export const ENEMY_DAMAGE_DIE = 4;

// Enemy types. Goblin is the baseline; skeletons are "about half a goblin" —
// fragile AND slow (`moveEvery: 2` = one tile every 2 turns; attacks are never
// slowed) — but hit with the same die. `glyph` is a presentation hint; the
// renderer's tileStyle owns the final glyph/color.
export const ENEMY_TYPES = Object.freeze({
  goblin: { kind: 'goblin', glyph: 'g', maxHp: 5, damageDie: ENEMY_DAMAGE_DIE, moveEvery: 1 },
  skeleton: { kind: 'skeleton', glyph: 's', maxHp: 3, damageDie: ENEMY_DAMAGE_DIE, moveEvery: 2 },
});

// Items.
export const POTION_HEAL = 8;

// Treasure chests. Contents are decided at spawn time (deterministic per seed)
// and stored on the item. Bonuses stack across a run; the trap hits like a
// goblin and respects armor (same rule as enemy attacks).
export const CHEST_EFFECT = Object.freeze({
  STRENGTH: 'strength',
  ARMOR: 'armor',
  HEALTH: 'health',
  TRAP: 'trap',
});
export const CHEST_STRENGTH_BONUS = 1; // +1 damage dealt per stack
export const CHEST_ARMOR_BONUS = 1; // -1 damage taken per stack
export const CHEST_HEALTH_BONUS = 5; // +5 max HP, and refill to full
export const CHEST_TRAP_DIE = ENEMY_DAMAGE_DIE; // rolled 1..die at spawn — a trap hits like a goblin

// Map + generation.
export const MAP_WIDTH = 72;
export const MAP_HEIGHT = 44;
export const MIN_ROOMS = 7;
export const MAX_ROOMS = 12;
export const MIN_ROOM_SIZE = 4;
export const MAX_ROOM_SIZE = 10;

// Population per floor (mildly RNG-varied; no depth curve in Phase 1).
export const MIN_ENEMIES = 5;
export const MAX_ENEMIES = 8;
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

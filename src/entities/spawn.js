// Populates a freshly generated floor with entities and items (enemies, health
// potions, treasure chests). Placement uses the game RNG and never puts two
// things on the same tile, never on a wall, stairs, door, or on the player.

import { nextInt, pick, chance } from '../core/rng.js';
import {
  TILE,
  MIN_ENEMIES,
  MAX_ENEMIES,
  ENEMY_COUNT_EVERY_FLOORS,
  ENEMY_COUNT_CAP,
  GOBLIN_WEIGHT_BASE,
  GOBLIN_WEIGHT_PER_FLOOR,
  GOBLIN_WEIGHT_MAX,
  MIN_POTIONS,
  MAX_POTIONS,
  MIN_CHESTS,
  MAX_CHESTS,
  ENEMY_TYPES,
  BOSS_FLOOR_INTERVAL,
} from '../core/constants.js';
import { idx, entityAt } from '../core/query.js';
import { addEntity, allocId } from '../core/entity.js';
import { createEnemy } from './enemies.js';
import { createPotion, createChest, createKey, createLockedChest } from './items.js';
import { bandOf, secretPlan } from '../world/secrets.js';

// How many tiles a single room scan samples before giving up. Every caller
// shares it — changing it reorders the RNG stream and moves the whole balance
// curve, so it is a constant, not a parameter.
const TILE_SCAN_ATTEMPTS = 30;

// Placement attempts for a band's key / locked chest. They are one-per-band and
// a run needs them, so they get more retries than an ordinary potion.
const SECRET_TRIES = 10;

// A random FLOOR tile within a room that no ENTITY stands on, or null if none
// was found quickly. FLOOR excludes doors and stairs, so nothing spawns in a
// doorway or on '>'. Items are deliberately not consulted here — see
// placeItem, which layers that on without changing what this scan draws.
export function randomFreeFloorInRoom(state, room) {
  const map = state.map;
  for (let attempt = 0; attempt < TILE_SCAN_ATTEMPTS; attempt++) {
    const x = nextInt(state.rng, room.x, room.x + room.w - 1);
    const y = nextInt(state.rng, room.y, room.y + room.h - 1);
    if (map.tiles[idx(map, x, y)] !== TILE.FLOOR) continue;
    if (entityAt(state, x, y)) continue;
    return { x, y };
  }
  return null;
}

export const itemAt = (state, x, y) => state.items.some((it) => it.x === x && it.y === y);

// Place one item: pick a room, scan it for an entity-free tile, reject the tile
// if an item is already there, and retry the whole thing up to `attempts`
// times. Returns the tile, or null if every attempt failed (the caller skips
// that spawn).
//
// Two things here are load-bearing and must not be "cleaned up":
//
//  - The item check happens AFTER the scan returns, not inside it. Skipping
//    item tiles within the scan would consume different RNG draws and land on
//    different tiles.
//  - `attempts` stays per-caller: one for potions and chests (a crowded room
//    simply loses that item), ten for the band's single key and locked chest,
//    which are too important to drop on one unlucky room.
//
// Both are what the old duplicated call sites did; either change reorders the
// seeded stream and regenerates every floor of every run. `npm run balance`
// byte-identity is what pins them.
function placeItem(state, roomPick, attempts) {
  for (let i = 0; i < attempts; i++) {
    const tile = randomFreeFloorInRoom(state, roomPick());
    if (!tile) continue;
    if (itemAt(state, tile.x, tile.y)) continue;
    return tile;
  }
  return null;
}

export function populateFloor(state, floorNumber) {
  spawnEnemies(state, floorNumber);
  if (floorNumber % BOSS_FLOOR_INTERVAL === 0) spawnBoss(state, floorNumber);
  spawnPotions(state);
  spawnChests(state);
  spawnSecrets(state, floorNumber);
}

// One boss guarding the down-stairs. The down-stairs sit at the center of the
// room farthest from the start room, so the lair is never where the player
// arrives. Falls back to a random non-start room if the stairs room has no
// free tile (same tolerance as regular spawns).
function spawnBoss(state, floorNumber) {
  const map = state.map;
  const rooms = map.rooms;
  if (rooms.length < 2 || !map.stairsDown) return;
  const stairsRoom = rooms[map.roomAt[idx(map, map.stairsDown.x, map.stairsDown.y)]];
  let tile = stairsRoom ? randomFreeFloorInRoom(state, stairsRoom) : null;
  if (!tile) tile = randomFreeFloorInRoom(state, rooms[nextInt(state.rng, 1, rooms.length - 1)]);
  if (!tile) return;
  addEntity(state, createEnemy(ENEMY_TYPES.boss, tile.x, tile.y, floorNumber));
}

// How many regular enemies a floor gets: the Phase-1 RNG band plus a depth
// bonus, so pressure keeps rising even after per-enemy stats plateau.
export function enemyCountFor(rng, floorNumber) {
  const depthBonus = Math.floor((floorNumber - 1) / ENEMY_COUNT_EVERY_FLOORS);
  return Math.min(ENEMY_COUNT_CAP, nextInt(rng, MIN_ENEMIES, MAX_ENEMIES) + depthBonus);
}

// The goblin share of the spawn mix: 50/50 on floor 1, drifting toward the
// tougher archetype with depth (capped so skeletons never vanish).
export function goblinShareFor(floorNumber) {
  return Math.min(
    GOBLIN_WEIGHT_MAX,
    GOBLIN_WEIGHT_BASE + GOBLIN_WEIGHT_PER_FLOOR * (floorNumber - 1),
  );
}

function spawnEnemies(state, floorNumber) {
  const rooms = state.map.rooms;
  if (rooms.length < 2) return; // room 0 is the player's; need somewhere else
  const count = enemyCountFor(state.rng, floorNumber);
  const goblinShare = goblinShareFor(floorNumber);
  for (let i = 0; i < count; i++) {
    // Never spawn in the starting room, so the player gets a beat to orient.
    const room = rooms[nextInt(state.rng, 1, rooms.length - 1)];
    const tile = randomFreeFloorInRoom(state, room);
    if (!tile) continue;
    const type = chance(state.rng, goblinShare) ? ENEMY_TYPES.goblin : ENEMY_TYPES.skeleton;
    addEntity(state, createEnemy(type, tile.x, tile.y, floorNumber));
  }
}

// Drop an item onto the floor under a fresh id. Every item spawn goes through
// here, so "items never share a tile" is one rule in one place.
function addItem(state, item) {
  item.id = allocId(state);
  state.items.push(item);
}

function spawnPotions(state) {
  const rooms = state.map.rooms;
  const count = nextInt(state.rng, MIN_POTIONS, MAX_POTIONS);
  for (let i = 0; i < count; i++) {
    const tile = placeItem(state, () => pick(state.rng, rooms), 1);
    if (tile) addItem(state, createPotion(tile.x, tile.y));
  }
}

function spawnChests(state) {
  const rooms = state.map.rooms;
  const count = nextInt(state.rng, MIN_CHESTS, MAX_CHESTS);
  for (let i = 0; i < count; i++) {
    // Guards against potions too — they spawned first into the same array.
    const tile = placeItem(state, () => pick(state.rng, rooms), 1);
    if (tile) addItem(state, createChest(state.rng, tile.x, tile.y));
  }
}

// The band's secrets (Phase 7): if this floor is its band's keyFloor, hide the
// key here; if it's the chestFloor, place the locked chest. WHICH floors (and
// WHICH ring) come from the pure per-band plan; WHERE on the floor uses the
// main RNG like every other spawn. The key never spawns in the start room —
// no instant glimmer where the player arrives. On total placement failure
// (vanishingly rare) the item is skipped: keys are interchangeable, so a
// later band's key still opens the chest.
function spawnSecrets(state, floorNumber) {
  const rooms = state.map.rooms;
  if (rooms.length < 2) return;
  const plan = secretPlan(state.seed, bandOf(floorNumber));
  if (floorNumber === plan.keyFloor) {
    const tile = placeItem(
      state,
      () => rooms[nextInt(state.rng, 1, rooms.length - 1)],
      SECRET_TRIES,
    );
    if (tile) addItem(state, createKey(tile.x, tile.y));
  }
  if (floorNumber === plan.chestFloor) {
    const tile = placeItem(state, () => pick(state.rng, rooms), SECRET_TRIES);
    if (tile) addItem(state, createLockedChest(tile.x, tile.y, plan.ring));
  }
}

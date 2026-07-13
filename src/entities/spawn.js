// Populates a freshly generated floor with entities and items (enemies, health
// potions, treasure chests). Placement uses the game RNG and never puts two
// things on the same tile, never on a wall, stairs, door, or on the player.

import { nextInt, pick } from '../core/rng.js';
import {
  TILE,
  MIN_ENEMIES,
  MAX_ENEMIES,
  MIN_POTIONS,
  MAX_POTIONS,
  MIN_CHESTS,
  MAX_CHESTS,
  ENEMY_TYPES,
  BOSS_FLOOR_INTERVAL,
} from '../core/constants.js';
import { idx, entityAt } from '../core/query.js';
import { addEntity, allocId } from '../core/entity.js';
import { createEnemy, SPAWNABLE_ENEMIES } from './enemies.js';
import { createPotion, createChest } from './items.js';

// A random unoccupied FLOOR tile within a room, or null if none found quickly.
// FLOOR excludes doors and stairs, so nothing spawns in a doorway or on '>'.
export function randomFreeFloorInRoom(state, room) {
  const map = state.map;
  for (let attempt = 0; attempt < 30; attempt++) {
    const x = nextInt(state.rng, room.x, room.x + room.w - 1);
    const y = nextInt(state.rng, room.y, room.y + room.h - 1);
    if (map.tiles[idx(map, x, y)] !== TILE.FLOOR) continue;
    if (entityAt(state, x, y)) continue;
    return { x, y };
  }
  return null;
}

export function populateFloor(state, floorNumber) {
  spawnEnemies(state);
  if (floorNumber % BOSS_FLOOR_INTERVAL === 0) spawnBoss(state);
  spawnPotions(state);
  spawnChests(state);
}

// One boss guarding the down-stairs. The down-stairs sit at the center of the
// room farthest from the start room, so the lair is never where the player
// arrives. Falls back to a random non-start room if the stairs room has no
// free tile (same tolerance as regular spawns).
function spawnBoss(state) {
  const map = state.map;
  const rooms = map.rooms;
  if (rooms.length < 2 || !map.stairsDown) return;
  const stairsRoom = rooms[map.roomAt[idx(map, map.stairsDown.x, map.stairsDown.y)]];
  let tile = stairsRoom ? randomFreeFloorInRoom(state, stairsRoom) : null;
  if (!tile) tile = randomFreeFloorInRoom(state, rooms[nextInt(state.rng, 1, rooms.length - 1)]);
  if (!tile) return;
  addEntity(state, createEnemy(ENEMY_TYPES.boss, tile.x, tile.y));
}

function spawnEnemies(state) {
  const rooms = state.map.rooms;
  if (rooms.length < 2) return; // room 0 is the player's; need somewhere else
  const count = nextInt(state.rng, MIN_ENEMIES, MAX_ENEMIES);
  for (let i = 0; i < count; i++) {
    // Never spawn in the starting room, so the player gets a beat to orient.
    const room = rooms[nextInt(state.rng, 1, rooms.length - 1)];
    const tile = randomFreeFloorInRoom(state, room);
    if (!tile) continue;
    const type = pick(state.rng, SPAWNABLE_ENEMIES);
    addEntity(state, createEnemy(type, tile.x, tile.y));
  }
}

function spawnPotions(state) {
  const rooms = state.map.rooms;
  const count = nextInt(state.rng, MIN_POTIONS, MAX_POTIONS);
  for (let i = 0; i < count; i++) {
    const room = pick(state.rng, rooms);
    const tile = randomFreeFloorInRoom(state, room);
    if (!tile) continue;
    if (state.items.some((it) => it.x === tile.x && it.y === tile.y)) continue;
    const potion = createPotion(tile.x, tile.y);
    potion.id = allocId(state);
    state.items.push(potion);
  }
}

function spawnChests(state) {
  const rooms = state.map.rooms;
  const count = nextInt(state.rng, MIN_CHESTS, MAX_CHESTS);
  for (let i = 0; i < count; i++) {
    const room = pick(state.rng, rooms);
    const tile = randomFreeFloorInRoom(state, room);
    if (!tile) continue;
    // Guards against potions too — they spawned first into the same array.
    if (state.items.some((it) => it.x === tile.x && it.y === tile.y)) continue;
    const chest = createChest(state.rng, tile.x, tile.y);
    chest.id = allocId(state);
    state.items.push(chest);
  }
}

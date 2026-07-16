import { describe, it, expect } from 'vitest';
import { ascend } from '../src/core/gameState.js';
import { createEnemy } from '../src/entities/enemies.js';
import { ENEMY_TYPES, TILE } from '../src/core/constants.js';
import { idx, getPlayer } from '../src/core/query.js';

// "Two entities never share a tile" must hold even for the audit's pathological
// arrival: the player ascends onto a stair whose 8 neighbors are ALL occupied
// by idle enemies. The BFS nudge must push the squatter one tile further out.

function roomMap(width, height) {
  const tiles = new Uint8Array(width * height); // all WALL
  const roomAt = new Int16Array(width * height).fill(-1);
  const map = { width, height, tiles, rooms: [], roomAt, stairsDown: null, stairsUp: null };
  // carve an open room with a 1-tile wall border
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) tiles[idx(map, x, y)] = TILE.FLOOR;
  }
  return map;
}

function crowdedCachedFloor() {
  // 9x9 room; down-stairs at the center (4,4); a squatter ON the stair and its
  // full 8-neighbor ring occupied — 9 enemies, free floor beyond the ring.
  const map = roomMap(9, 9);
  map.tiles[idx(map, 4, 4)] = TILE.STAIRS_DOWN;
  map.stairsDown = { x: 4, y: 4 };
  const byId = new Map();
  let id = 5;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const e = createEnemy(ENEMY_TYPES.goblin, 4 + dx, 4 + dy, 1);
      e.id = id++;
      byId.set(e.id, e);
    }
  }
  return {
    map,
    vis: { visible: new Uint8Array(81), explored: new Uint8Array(81) },
    items: [],
    byId,
    nextId: id,
  };
}

function stateOnFloor2(cachedFloor1) {
  const f2map = roomMap(5, 5);
  f2map.tiles[idx(f2map, 2, 2)] = TILE.STAIRS_UP;
  f2map.stairsUp = { x: 2, y: 2 };
  const player = {
    id: 1,
    kind: 'player',
    x: 2,
    y: 2,
    hp: 20,
    maxHp: 20,
    attackDie: 8,
    strength: 0,
    skill: 0,
    armor: 0,
  };
  return {
    rng: { seed: 1, s: 1 },
    status: 'playing',
    turn: 0,
    floor: 2,
    log: [],
    items: [],
    path: null,
    map: f2map,
    vis: { visible: new Uint8Array(25), explored: new Uint8Array(25) },
    entities: { nextId: 20, playerId: 1, byId: new Map([[1, player]]) },
    floors: new Map([[1, cachedFloor1]]),
  };
}

describe('ensureArrivalClear', () => {
  it('resolves a fully ringed arrival stair — no two entities share a tile', () => {
    const state = stateOnFloor2(crowdedCachedFloor());
    ascend(state);
    expect(state.floor).toBe(1);
    const player = getPlayer(state);
    expect(player.x).toBe(4);
    expect(player.y).toBe(4); // player owns the stair tile
    const keys = new Set();
    for (const e of state.entities.byId.values()) {
      const key = `${e.x},${e.y}`;
      expect(keys.has(key), `two entities share ${key}`).toBe(false);
      keys.add(key);
      expect(state.map.tiles[idx(state.map, e.x, e.y)]).not.toBe(TILE.WALL);
    }
    expect(state.entities.byId.size).toBe(10); // player + 9 enemies, all placed
  });

  it('keeps the classic single-ring nudge identical when a neighbor is free', () => {
    // Only the stair itself is occupied: the squatter must land on the FIRST
    // free DIRS8 neighbor (north), exactly as before the BFS hardening — this
    // is what keeps seeded replays byte-identical.
    const cached = crowdedCachedFloor();
    for (const [id, e] of [...cached.byId]) {
      if (!(e.x === 4 && e.y === 4)) cached.byId.delete(id);
    }
    const state = stateOnFloor2(cached);
    ascend(state);
    const squatter = [...state.entities.byId.values()].find((e) => e.id !== 1);
    expect({ x: squatter.x, y: squatter.y }).toEqual({ x: 4, y: 3 }); // N, first in DIRS8
  });
});

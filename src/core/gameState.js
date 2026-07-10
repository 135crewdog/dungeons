// The single authoritative game-state object and its lifecycle. Every system
// reads from and writes to the state produced here; no system keeps its own
// copy. createGame builds a fresh run; descend (added with stairs) rebuilds the
// floor while carrying the player over.

import { createRng } from './rng.js';
import { idx } from './query.js';
import { TILE, MAP_WIDTH, MAP_HEIGHT } from './constants.js';
import { createPlayer } from '../entities/player.js';

// Allocate a fresh, monotonically increasing entity id. Ascending ids define
// deterministic turn order.
export function allocId(state) {
  return state.entities.nextId++;
}

// Add an entity to the state, assigning it an id. Returns the entity.
export function addEntity(state, entity) {
  entity.id = allocId(state);
  state.entities.byId.set(entity.id, entity);
  return entity;
}

// Allocate empty visibility layers sized to a map.
export function makeVisibility(width, height) {
  return {
    visible: new Uint8Array(width * height),
    explored: new Uint8Array(width * height),
  };
}

// Append a structured message to the log (UI formats it into a string later).
export function pushLog(state, type, data = {}) {
  state.log.push({ turn: state.turn, type, data });
}

// Build a fresh game. `seed` may be a number or string; if omitted, callers
// (main.js) generate a random one and pass it in.
export function createGame(seed) {
  const rng = createRng(seed);
  const state = {
    seed: rng.seed,
    rng,
    turn: 0,
    floor: 1,
    status: 'playing',
    map: null,
    vis: null,
    entities: { nextId: 1, playerId: 0, byId: new Map() },
    items: [],
    path: null,
    prevVisibleEnemies: new Set(),
    log: [],
  };

  buildFloor(state, state.floor);
  return state;
}

// Assemble a floor onto the state: map, visibility, player placement.
// The real procedural generator and floor population replace the placeholder
// map in later milestones; the state shape it produces is already final.
function buildFloor(state, floorNumber) {
  const map = placeholderMap(MAP_WIDTH, MAP_HEIGHT);
  state.map = map;
  state.vis = makeVisibility(map.width, map.height);
  state.items = [];
  state.path = null;
  state.prevVisibleEnemies = new Set();

  const start = map.rooms[0];
  const px = start.x + (start.w >> 1);
  const py = start.y + (start.h >> 1);
  const player = createPlayer(px, py);
  addEntity(state, player);
  state.entities.playerId = player.id;
}

// TEMPORARY placeholder: one big rectangular room in a wall field. Replaced by
// world/dungeon.generateFloor in the dungeon-generation milestone. It exists so
// the state skeleton is valid and inspectable now.
function placeholderMap(width, height) {
  const tiles = new Uint8Array(width * height).fill(TILE.WALL);
  const roomAt = new Int16Array(width * height).fill(-1);
  const room = {
    id: 0,
    x: 3,
    y: 3,
    w: width - 6,
    h: height - 6,
  };
  const map = { width, height, tiles, rooms: [room], roomAt, stairs: { x: 0, y: 0 } };
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      tiles[idx(map, x, y)] = TILE.FLOOR;
      roomAt[idx(map, x, y)] = room.id;
    }
  }
  const sx = room.x + room.w - 2;
  const sy = room.y + room.h - 2;
  tiles[idx(map, sx, sy)] = TILE.STAIRS;
  map.stairs = { x: sx, y: sy };
  return map;
}

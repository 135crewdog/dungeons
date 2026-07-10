// The single authoritative game-state object and its lifecycle. Every system
// reads from and writes to the state produced here; no system keeps its own
// copy. createGame builds a fresh run; descend (added with stairs) rebuilds the
// floor while carrying the player over.

import { createRng } from './rng.js';
import { generateFloor } from '../world/dungeon.js';
import { roomCenter } from '../world/rooms.js';
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

// Assemble a floor onto the state: generate the map, reset per-floor fields,
// and place the player in the first room. Floor population (enemies, potions)
// is layered on in later milestones.
function buildFloor(state, floorNumber) {
  const map = generateFloor(state.rng, floorNumber);
  state.map = map;
  state.vis = makeVisibility(map.width, map.height);
  state.items = [];
  state.path = null;
  state.prevVisibleEnemies = new Set();

  const start = roomCenter(map.rooms[0]);
  const player = createPlayer(start.x, start.y);
  addEntity(state, player);
  state.entities.playerId = player.id;
}

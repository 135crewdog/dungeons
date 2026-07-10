// The single authoritative game-state object and its lifecycle. Every system
// reads from and writes to the state produced here; no system keeps its own
// copy. createGame builds a fresh run; descend (added with stairs) rebuilds the
// floor while carrying the player over.

import { createRng } from './rng.js';
import { addEntity } from './entity.js';
import { generateFloor } from '../world/dungeon.js';
import { roomCenter } from '../world/rooms.js';
import { createPlayer } from '../entities/player.js';
import { populateFloor } from '../entities/spawn.js';
import { updateVisibility } from '../systems/visibility.js';

// Allocate empty visibility layers sized to a map.
export function makeVisibility(width, height) {
  return {
    visible: new Uint8Array(width * height),
    explored: new Uint8Array(width * height),
  };
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

  // Populate enemies (and, later, items) after the player exists so nothing
  // spawns on top of them.
  populateFloor(state, floorNumber);

  // Compute the initial view so the first frame shows what the player can see.
  updateVisibility(state);
}

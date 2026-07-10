// The single authoritative game-state object and its lifecycle. Every system
// reads from and writes to the state produced here; no system keeps its own
// copy. createGame builds a fresh run; descend (added with stairs) rebuilds the
// floor while carrying the player over.

import { createRng } from './rng.js';
import { addEntity } from './entity.js';
import { getPlayer } from './query.js';
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

// Generate down the stairs: a completely new floor, carrying the player (and
// its HP) over. Everything else — enemies, items, fog, stored path — is fresh.
export function descend(state) {
  const player = getPlayer(state);
  state.floor++;
  buildFloor(state, state.floor, player);
}

// Assemble a floor onto the state: generate the map, reset all per-floor fields
// and the entity registry, place the player in the first room, then populate
// enemies and potions. Pass an existing player to carry it across floors.
function buildFloor(state, floorNumber, existingPlayer = null) {
  const map = generateFloor(state.rng, floorNumber);
  state.map = map;
  state.vis = makeVisibility(map.width, map.height);
  state.items = [];
  state.path = null;
  state.prevVisibleEnemies = new Set();
  state.entities.byId = new Map();
  state.entities.nextId = 1;

  const start = roomCenter(map.rooms[0]);
  const player = existingPlayer ?? createPlayer(start.x, start.y);
  player.x = start.x;
  player.y = start.y;
  addEntity(state, player);
  state.entities.playerId = player.id;

  // Populate after the player exists so nothing spawns on top of them.
  populateFloor(state, floorNumber);

  // Compute the initial view so the first frame shows what the player can see.
  updateVisibility(state);
}

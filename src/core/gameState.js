// The single authoritative game-state object and its lifecycle. Every system
// reads from and writes to the state produced here; no system keeps its own
// copy. createGame builds a fresh run; descend/ascend move the player between
// floors, caching each floor so it can be revisited exactly as it was left.

import { createRng } from './rng.js';
import { PLAYER_ID, DIRS8 } from './constants.js';
import { getPlayer, entityAt, isWalkable } from './query.js';
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
    entities: { nextId: 2, playerId: PLAYER_ID, byId: new Map() },
    items: [],
    path: null,
    // Visited floors, keyed by floor number → { map, vis, items, byId, nextId }.
    // The active floor's data lives on state.map/vis/items/entities; a floor is
    // moved into this cache when the player leaves it and restored on return.
    floors: new Map(),
    log: [],
  };

  generateAndEnter(state, 1, createPlayer(0, 0));
  return state;
}

// Go down the stairs. Stash the current floor, then restore the floor below if
// it has been visited before (arriving at its up-stairs) or generate it fresh.
// The player object — and its HP — carries over either way.
export function descend(state) {
  const player = getPlayer(state);
  const target = state.floor + 1;
  snapshotFloor(state);
  if (state.floors.has(target)) {
    activateFloor(state, target, 'up', player);
  } else {
    generateAndEnter(state, target, player);
  }
}

// Go up the stairs. The floor above has always been visited (you descended
// through it), so it is restored from the cache; the player arrives at its
// down-stairs — the tile they originally descended from.
export function ascend(state) {
  if (state.floor <= 1) return; // no way up from the top floor
  const player = getPlayer(state);
  const target = state.floor - 1;
  snapshotFloor(state);
  activateFloor(state, target, 'down', player);
}

// Reset the existing state object in place to a brand-new run on floor 1 with a
// new seed. Resetting in place (rather than making a new object) keeps every
// holder of this state — scene, controller, HUD — pointing at the live run.
export function restart(state, seed) {
  const rng = createRng(seed);
  state.seed = rng.seed;
  state.rng = rng;
  state.turn = 0;
  state.floor = 1;
  state.status = 'playing';
  state.log = [];
  state.items = [];
  state.floors = new Map();
  state.entities = { nextId: 2, playerId: PLAYER_ID, byId: new Map() };
  generateAndEnter(state, 1, createPlayer(0, 0));
}

// Insert the carried player under its fixed id and make it the active player.
// Enemies/items allocate from id 2 up, so this id is always free.
function attachPlayer(state, player, x, y) {
  player.id = PLAYER_ID;
  player.x = x;
  player.y = y;
  state.entities.byId.set(PLAYER_ID, player);
  state.entities.playerId = PLAYER_ID;
}

// Move the live floor (minus the player) into the cache under its floor number.
function snapshotFloor(state) {
  state.entities.byId.delete(PLAYER_ID);
  state.floors.set(state.floor, {
    map: state.map,
    vis: state.vis,
    items: state.items,
    byId: state.entities.byId,
    nextId: state.entities.nextId,
  });
}

// Restore a previously-cached floor and drop the player onto the appropriate
// stair (up-stairs when descending into it, down-stairs when ascending).
function activateFloor(state, floorNumber, arrival, player) {
  const cached = state.floors.get(floorNumber);
  state.floor = floorNumber;
  state.map = cached.map;
  state.vis = cached.vis;
  state.items = cached.items;
  state.entities.byId = cached.byId;
  state.entities.nextId = cached.nextId;
  state.path = null;

  const pos = arrival === 'up' ? state.map.stairsUp : state.map.stairsDown;
  ensureArrivalClear(state, pos.x, pos.y);
  attachPlayer(state, player, pos.x, pos.y);
  updateVisibility(state);
}

// Generate a brand-new floor and enter it. The player lands on the up-stairs
// (floor 1 has none, so it uses the start room's center instead).
function generateAndEnter(state, floorNumber, player) {
  const map = generateFloor(state.rng, floorNumber);
  state.floor = floorNumber;
  state.map = map;
  state.vis = makeVisibility(map.width, map.height);
  state.items = [];
  state.path = null;
  state.entities.byId = new Map();
  state.entities.nextId = 2; // reserve id 1 for the player (attached below)

  const start = map.stairsUp ?? roomCenter(map.rooms[0]);
  attachPlayer(state, player, start.x, start.y);

  // Populate after the player exists so nothing spawns on top of them.
  populateFloor(state, floorNumber);

  // Compute the initial view so the first frame shows what the player can see.
  updateVisibility(state);
}

// If a stray (de-aggroed) enemy is standing on the tile the player is about to
// arrive on, nudge it to a free neighboring tile so the two never share a tile.
// Neighbors are tried first (the enemy barely moves); if all eight are blocked,
// fall back to a deterministic scan for any free walkable tile so the no-shared-
// tile invariant always holds.
function ensureArrivalClear(state, x, y) {
  const occ = entityAt(state, x, y);
  if (!occ) return;
  for (const { dx, dy } of DIRS8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!isWalkable(state.map, nx, ny)) continue;
    if (entityAt(state, nx, ny)) continue;
    occ.x = nx;
    occ.y = ny;
    return;
  }
  for (let ny = 0; ny < state.map.height; ny++) {
    for (let nx = 0; nx < state.map.width; nx++) {
      if (!isWalkable(state.map, nx, ny) || entityAt(state, nx, ny)) continue;
      occ.x = nx;
      occ.y = ny;
      return;
    }
  }
  throw new Error('No free tile available for staircase arrival');
}

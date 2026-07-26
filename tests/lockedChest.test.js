import { describe, it, expect } from 'vitest';
import { processCommand } from '../src/core/turnEngine.js';
import { createRng } from '../src/core/rng.js';
import { createEnemy } from '../src/entities/enemies.js';
import { ENEMY_TYPES, TILE, RING } from '../src/core/constants.js';
import { idx } from '../src/core/query.js';
import { EV } from '../src/core/events.js';

// An 8x8 walled room with the player at (2,2) and a configurable item list —
// the items.test.js miniState, extended for Phase-7 secrets.
function miniState({ items = [], playerAt = { x: 2, y: 2 }, keys = 0, floors = null } = {}) {
  const width = 8;
  const height = 8;
  const tiles = new Uint8Array(width * height).fill(floors ? TILE.WALL : TILE.FLOOR);
  const map = {
    width,
    height,
    tiles,
    rooms: [],
    roomAt: new Int16Array(width * height).fill(-1),
    stairs: null,
  };
  if (floors) {
    for (const { x, y } of floors) tiles[idx(map, x, y)] = TILE.FLOOR;
  } else {
    for (let x = 0; x < width; x++) {
      tiles[idx(map, x, 0)] = TILE.WALL;
      tiles[idx(map, x, height - 1)] = TILE.WALL;
    }
    for (let y = 0; y < height; y++) {
      tiles[idx(map, 0, y)] = TILE.WALL;
      tiles[idx(map, width - 1, y)] = TILE.WALL;
    }
  }
  const player = {
    id: 1,
    kind: 'player',
    x: playerAt.x,
    y: playerAt.y,
    hp: 20,
    maxHp: 20,
    attackDie: 8,
    skill: 0,
    strength: 0,
    armor: 0,
    keys,
    glyph: '@',
  };
  const state = {
    rng: createRng(1),
    status: 'playing',
    turn: 0,
    floor: 1,
    map,
    vis: { visible: new Uint8Array(width * height), explored: new Uint8Array(width * height) },
    entities: { nextId: 50, playerId: 1, byId: new Map([[1, player]]) },
    items,
    path: null,
    floors: new Map(),
    log: [],
  };
  return { state, player };
}

const lockedChest = (x, y, ring = RING.SIGHT) => ({ id: 40, type: 'lockedChest', x, y, ring });
const lockedLogs = (state) => state.log.filter((e) => e.type === 'locked');

describe('locked chests without a key', () => {
  it('announces once on arrival and stays put', () => {
    const { state, player } = miniState({ items: [lockedChest(3, 2)] });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.x).toBe(3);
    expect(state.items).toHaveLength(1); // never consumed
    expect(player.keys).toBe(0);
    expect(events.filter((e) => e.type === EV.LOCKED)).toHaveLength(1);
    expect(lockedLogs(state)).toHaveLength(1);
  });

  it('stays silent on a stationary turn spent on the chest tile', () => {
    const { state, player } = miniState({ items: [lockedChest(3, 2)] });
    processCommand(state, { type: 'move', dx: 1, dy: 0 }); // arrive: one announcement
    // A bump-attack from the chest tile consumes a turn without moving.
    const goblin = createEnemy(ENEMY_TYPES.goblin, 4, 2, 1);
    goblin.id = 2;
    goblin.moveCooldown = 99;
    state.entities.byId.set(2, goblin);
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.x).toBe(3); // swung, didn't move
    expect(events.filter((e) => e.type === EV.LOCKED)).toHaveLength(0);
    expect(lockedLogs(state)).toHaveLength(1); // still just the arrival
  });

  it('re-announces after stepping off and back on', () => {
    const { state } = miniState({ items: [lockedChest(3, 2)] });
    processCommand(state, { type: 'move', dx: 1, dy: 0 }); // on
    processCommand(state, { type: 'move', dx: -1, dy: 0 }); // off
    processCommand(state, { type: 'move', dx: 1, dy: 0 }); // back on
    expect(lockedLogs(state)).toHaveLength(2);
  });
});

describe('unlocking with a key', () => {
  it('spends the key, consumes the chest, and drops the ring beside it', () => {
    const { state, player } = miniState({ items: [lockedChest(3, 2, RING.SHADOW)], keys: 1 });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.keys).toBe(0);
    expect(state.items).toHaveLength(1);
    const ring = state.items[0];
    // DIRS8 scans N first: the tile above the chest is free floor.
    expect(ring).toMatchObject({ type: 'ring', ring: RING.SHADOW, x: 3, y: 1 });
    expect(events.find((e) => e.type === EV.PICKUP)).toMatchObject({
      item: 'lockedChest',
      effect: RING.SHADOW,
    });
    expect(state.log.some((e) => e.type === 'unlock')).toBe(true);
    expect(player.ringShadow ?? false).toBe(false); // not worn yet — it's on the floor
  });

  it('walking onto the dropped ring wears it', () => {
    const { state, player } = miniState({ items: [lockedChest(3, 2, RING.SPEED)], keys: 1 });
    processCommand(state, { type: 'move', dx: 1, dy: 0 }); // unlock; ring lands at (3,1)
    processCommand(state, { type: 'move', dx: 0, dy: -1 }); // step onto the ring
    expect(player.ringSpeed).toBe(true);
    expect(state.items).toHaveLength(0);
    expect(state.log.some((e) => e.type === 'pickup' && e.data.item === 'ring')).toBe(true);
  });

  it('grants the ring directly when every neighbor tile is blocked', () => {
    // A two-tile corridor: the only non-wall neighbor of the chest already
    // holds an item, so the drop scan finds nothing and the ring goes
    // straight onto the player's finger.
    const { state, player } = miniState({
      floors: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
      items: [{ id: 41, type: 'potion', x: 2, y: 2, heal: 8 }, lockedChest(3, 2, RING.SURVIVAL)],
      keys: 1,
    });
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.keys).toBe(0);
    expect(player.ringSurvival).toBe(true);
    expect(state.items.filter((it) => it.type === 'ring')).toHaveLength(0);
  });

  it('keys are interchangeable and stack', () => {
    const { state, player } = miniState({
      items: [lockedChest(3, 2), lockedChest(5, 2, RING.SPEED)],
      keys: 2,
    });
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.keys).toBe(1);
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.keys).toBe(0);
    expect(state.items.filter((it) => it.type === 'lockedChest')).toHaveLength(0);
  });

  it('a duplicate permanent ring is a no-op; a duplicate Survival ring re-arms', () => {
    const { state, player } = miniState({
      items: [
        { id: 42, type: 'ring', x: 3, y: 2, ring: RING.SIGHT },
        { id: 43, type: 'ring', x: 4, y: 2, ring: RING.SURVIVAL },
      ],
    });
    player.ringSight = true; // already worn
    player.ringSurvival = false; // spent earlier in the "run"
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.ringSight).toBe(true);
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.ringSurvival).toBe(true); // re-armed
    expect(state.items).toHaveLength(0);
  });
});

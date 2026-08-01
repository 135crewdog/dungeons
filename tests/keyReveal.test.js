import { describe, it, expect } from 'vitest';
import { processCommand } from '../src/core/turnEngine.js';
import { createRng } from '../src/core/rng.js';
import { updateVisibility } from '../src/systems/visibility.js';
import { TILE, KEY_REVEAL_RADIUS } from '../src/core/constants.js';
import { idx } from '../src/core/query.js';
import { EV } from '../src/core/events.js';

// A horizontal corridor (y=1, x=1..12 in a 14x3 wall field) with an optional
// closed door and a hidden key. Everything pre-explored; visibility real.
function corridor({ playerX, doorX = null, keyX }) {
  const width = 14;
  const height = 3;
  const tiles = new Uint8Array(width * height); // WALL
  const map = {
    width,
    height,
    tiles,
    rooms: [],
    roomAt: new Int16Array(width * height).fill(-1),
    stairsDown: null,
    stairsUp: null,
  };
  for (let x = 1; x <= 12; x++) tiles[idx(map, x, 1)] = TILE.FLOOR;
  if (doorX !== null) tiles[idx(map, doorX, 1)] = TILE.DOOR;
  const player = {
    id: 1,
    kind: 'player',
    x: playerX,
    y: 1,
    hp: 20,
    maxHp: 20,
    attackDie: 8,
    skill: 0,
    strength: 0,
    armor: 0,
    keys: 0,
    glyph: '@',
  };
  const key = { id: 30, type: 'key', x: keyX, y: 1, hidden: true };
  const state = {
    rng: createRng(1),
    status: 'playing',
    turn: 0,
    floor: 1,
    map,
    vis: { visible: new Uint8Array(width * height), explored: new Uint8Array(width * height) },
    entities: { nextId: 2, playerId: 1, byId: new Map([[1, player]]) },
    items: [key],
    path: null,
    floors: new Map(),
    log: [],
  };
  state.vis.explored.fill(1);
  updateVisibility(state);
  return { state, player, key };
}

const revealLogs = (state) => state.log.filter((e) => e.type === 'reveal');

describe('hidden key proximity reveal', () => {
  it(`stays hidden beyond ${KEY_REVEAL_RADIUS} tiles even in plain sight`, () => {
    const { state, key } = corridor({ playerX: 2, keyX: 6 });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 }); // now 3 tiles away
    expect(key.hidden).toBe(true);
    expect(events.filter((e) => e.type === EV.REVEAL)).toHaveLength(0);
    expect(revealLogs(state)).toHaveLength(0);
  });

  it('reveals exactly once when the player closes to the radius', () => {
    const { state, key } = corridor({ playerX: 3, keyX: 6 });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 }); // 2 tiles away
    expect(key.hidden).toBe(false);
    expect(events.filter((e) => e.type === EV.REVEAL)).toHaveLength(1);
    processCommand(state, { type: 'move', dx: 1, dy: 0 }); // lingering nearby
    expect(revealLogs(state)).toHaveLength(1); // no re-announce
  });

  it('does not glimmer through a closed door', () => {
    const { state, key } = corridor({ playerX: 3, doorX: 5, keyX: 6 });
    processCommand(state, { type: 'move', dx: 1, dy: 0 }); // 2 away, door between
    expect(key.hidden).toBe(true);
    // Standing IN the doorway restores line of sight — now it glimmers.
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(key.hidden).toBe(false);
    expect(revealLogs(state)).toHaveLength(1);
  });

  it('stepping onto a hidden key reveals then collects it in the same turn', () => {
    const { state, player } = corridor({ playerX: 7, keyX: 6 });
    const events = processCommand(state, { type: 'move', dx: -1, dy: 0 });
    expect(player.keys).toBe(1);
    expect(state.items).toHaveLength(0);
    expect(events.filter((e) => e.type === EV.REVEAL)).toHaveLength(1);
    expect(events.filter((e) => e.type === EV.PICKUP)).toHaveLength(1);
    expect(revealLogs(state)).toHaveLength(1);
    expect(state.log.some((e) => e.type === 'pickup' && e.data.item === 'key')).toBe(true);
  });

  it('the Ring of Sight does not reveal hidden keys', () => {
    const { state, key } = corridor({ playerX: 2, keyX: 10 });
    state.entities.byId.get(1).ringSight = true;
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(state.vis.explored.every((v) => v === 1)).toBe(true); // whole floor known
    expect(key.hidden).toBe(true); // but the secret keeps its secret
  });
});

// Floor 1 with a down-staircase, plus a pre-cached floor 2 holding a hidden key
// `keyGap` tiles east of its up-staircase — where the player lands. Caching
// floor 2 (rather than letting the generator make one) is what makes the
// arrival geometry exact; descend() restores it through activateFloor.
function twoFloors({ keyGap }) {
  const { state, player } = corridor({ playerX: 5, keyX: 99 });
  state.items = []; // floor 1 carries no key
  state.map.tiles[idx(state.map, 6, 1)] = TILE.STAIRS_DOWN;
  state.map.stairsDown = { x: 6, y: 1 };

  const width = 14;
  const height = 3;
  const tiles = new Uint8Array(width * height); // WALL
  const map = {
    width,
    height,
    tiles,
    rooms: [],
    roomAt: new Int16Array(width * height).fill(-1),
    stairsDown: null,
    stairsUp: { x: 3, y: 1 },
  };
  for (let x = 1; x <= 12; x++) tiles[x + width] = TILE.FLOOR;
  tiles[3 + width] = TILE.STAIRS_UP;
  const key = { id: 31, type: 'key', x: 3 + keyGap, y: 1, hidden: true };
  const explored = new Uint8Array(width * height).fill(1);
  state.floors.set(2, {
    map,
    vis: { visible: new Uint8Array(width * height), explored },
    items: [key],
    byId: new Map(),
    nextId: 50,
  });
  return { state, player, key };
}

describe('arriving on a floor runs the reveal pass', () => {
  it('glimmers a key beside the arrival stair on arrival, not a command later', () => {
    const { state, key } = twoFloors({ keyGap: KEY_REVEAL_RADIUS });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 }); // take the stairs
    expect(state.floor).toBe(2);
    expect(key.hidden).toBe(false);
    expect(events.filter((e) => e.type === EV.REVEAL)).toHaveLength(1);
    expect(revealLogs(state)).toHaveLength(1);
  });

  it('leaves a key beyond the radius hidden, same as anywhere else', () => {
    const { state, key } = twoFloors({ keyGap: KEY_REVEAL_RADIUS + 1 });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(state.floor).toBe(2);
    expect(key.hidden).toBe(true);
    expect(events.filter((e) => e.type === EV.REVEAL)).toHaveLength(0);
  });

  it('announces it once, not again on the next command', () => {
    const { state } = twoFloors({ keyGap: KEY_REVEAL_RADIUS });
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(revealLogs(state)).toHaveLength(1);
  });
});

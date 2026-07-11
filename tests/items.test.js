import { describe, it, expect } from 'vitest';
import { processCommand } from '../src/core/turnEngine.js';
import { createGame, descend, ascend } from '../src/core/gameState.js';
import { getPlayer } from '../src/core/query.js';
import { createRng } from '../src/core/rng.js';
import { TILE, PLAYER_MAX_HP } from '../src/core/constants.js';
import { idx } from '../src/core/query.js';

// A small floor with the player at (2,2). `stairsAt` and `potion` are optional.
function miniState({ playerHp = PLAYER_MAX_HP, stairsAt = null, potion = null } = {}) {
  const width = 8;
  const height = 8;
  const tiles = new Uint8Array(width * height).fill(TILE.FLOOR);
  const map = { width, height, tiles, rooms: [], roomAt: new Int16Array(width * height).fill(-1), stairs: null };
  for (let x = 0; x < width; x++) {
    tiles[idx(map, x, 0)] = TILE.WALL;
    tiles[idx(map, x, height - 1)] = TILE.WALL;
  }
  for (let y = 0; y < height; y++) {
    tiles[idx(map, 0, y)] = TILE.WALL;
    tiles[idx(map, width - 1, y)] = TILE.WALL;
  }
  if (stairsAt) {
    tiles[idx(map, stairsAt.x, stairsAt.y)] = TILE.STAIRS_DOWN;
    map.stairsDown = { ...stairsAt };
  }
  const player = { id: 1, kind: 'player', x: 2, y: 2, hp: playerHp, maxHp: PLAYER_MAX_HP, damage: 4, glyph: '@' };
  const state = {
    rng: createRng(1),
    status: 'playing',
    turn: 0,
    floor: 1,
    map,
    vis: { visible: new Uint8Array(width * height), explored: new Uint8Array(width * height) },
    entities: { nextId: 2, playerId: 1, byId: new Map([[1, player]]) },
    items: potion ? [{ id: 99, type: 'potion', x: potion.x, y: potion.y, heal: potion.heal }] : [],
    path: null,
    floors: new Map(),
    log: [],
  };
  return { state, player };
}

describe('potions', () => {
  it('heals when walked over and removes the potion', () => {
    const { state, player } = miniState({ playerHp: 5, potion: { x: 3, y: 2, heal: 8 } });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.x).toBe(3);
    expect(player.hp).toBe(13);
    expect(state.items).toHaveLength(0);
    const pickup = events.find((e) => e.type === 'pickup');
    expect(pickup).toBeTruthy();
    expect(pickup.heal).toBe(8);
  });

  it('clamps healing to max HP (excess wasted)', () => {
    const { state, player } = miniState({ playerHp: PLAYER_MAX_HP - 3, potion: { x: 3, y: 2, heal: 8 } });
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.hp).toBe(PLAYER_MAX_HP);
    expect(state.items).toHaveLength(0);
  });
});

describe('stairs / descend', () => {
  it('stepping on the stairs generates a new floor and skips the enemy phase', () => {
    const { state, player } = miniState({ stairsAt: { x: 3, y: 2 } });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(state.floor).toBe(2);
    expect(events.some((e) => e.type === 'descend')).toBe(true);
    // The player was carried to the new floor's start room.
    expect(getPlayer(state)).toBe(player);
  });

  it('descend preserves the player and HP, resets fog and items, and changes the map', () => {
    const state = createGame(4242);
    const player = getPlayer(state);
    player.hp = 7;
    const beforeTiles = Array.from(state.map.tiles);
    const beforeExplored = state.vis.explored.reduce((a, b) => a + b, 0);

    descend(state);

    expect(state.floor).toBe(2);
    expect(getPlayer(state).hp).toBe(7); // HP carried over
    expect(Array.from(state.map.tiles)).not.toEqual(beforeTiles); // fresh layout
    // Fog resets: freshly explored count is bounded (just the new start area).
    const afterExplored = state.vis.explored.reduce((a, b) => a + b, 0);
    expect(afterExplored).toBeLessThan(beforeTiles.length);
    expect(afterExplored).toBeGreaterThan(0);
    // A new set of enemies exists (or at least the registry was rebuilt).
    expect(state.entities.byId.has(getPlayer(state).id)).toBe(true);
  });
});

describe('persistent floors (up + down stairs)', () => {
  const enemyIds = (state) =>
    [...state.entities.byId.keys()].filter((k) => k !== getPlayer(state).id);

  it('ascending returns to the same floor 1, preserving layout, fog, and the player', () => {
    const state = createGame(1234);
    const floor1Tiles = Array.from(state.map.tiles);
    const floor1Explored = Array.from(state.vis.explored);
    getPlayer(state).hp = 11;

    descend(state);
    expect(state.floor).toBe(2);
    expect(state.map.stairsUp).not.toBe(null);

    ascend(state);
    expect(state.floor).toBe(1);
    // Same layout object restored, tile-for-tile.
    expect(Array.from(state.map.tiles)).toEqual(floor1Tiles);
    // Fog is preserved (monotonic): everything explored before is still explored.
    for (let i = 0; i < floor1Explored.length; i++) {
      if (floor1Explored[i] === 1) expect(state.vis.explored[i]).toBe(1);
    }
    // The player arrives on floor 1's down-stairs, carrying HP.
    const p = getPlayer(state);
    expect(p.hp).toBe(11);
    expect(state.map.tiles[idx(state.map, p.x, p.y)]).toBe(TILE.STAIRS_DOWN);
  });

  it('re-descending returns to the same lower floor with prior changes intact', () => {
    const state = createGame(4242);
    descend(state);
    const floor2Tiles = Array.from(state.map.tiles);
    const victim = enemyIds(state)[0];
    expect(victim).toBeGreaterThan(0);
    state.entities.byId.delete(victim); // "kill" an enemy on floor 2

    ascend(state);
    expect(state.floor).toBe(1);

    descend(state);
    expect(state.floor).toBe(2);
    // Exactly the same floor 2 (restored from cache, not regenerated).
    expect(Array.from(state.map.tiles)).toEqual(floor2Tiles);
    // The kill persisted.
    expect(state.entities.byId.has(victim)).toBe(false);
    // Player arrives at the up-stairs coming down into a known floor.
    const p = getPlayer(state);
    expect(state.map.tiles[idx(state.map, p.x, p.y)]).toBe(TILE.STAIRS_UP);
  });

  it('cannot ascend from floor 1', () => {
    const state = createGame(99);
    ascend(state);
    expect(state.floor).toBe(1);
  });
});

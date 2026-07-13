import { describe, it, expect } from 'vitest';
import { processCommand } from '../src/core/turnEngine.js';
import { canStep } from '../src/core/movement.js';
import { TILE } from '../src/core/constants.js';
import { idx } from '../src/core/query.js';

// Build a small handcrafted state so movement outcomes are exact. All interior
// tiles are floor unless overridden via `walls`.
function miniState(width, height, walls = []) {
  const tiles = new Uint8Array(width * height).fill(TILE.FLOOR);
  const map = {
    width,
    height,
    tiles,
    rooms: [],
    roomAt: new Int16Array(width * height).fill(-1),
    stairs: null,
  };
  // Solid border.
  for (let x = 0; x < width; x++) {
    tiles[idx(map, x, 0)] = TILE.WALL;
    tiles[idx(map, x, height - 1)] = TILE.WALL;
  }
  for (let y = 0; y < height; y++) {
    tiles[idx(map, 0, y)] = TILE.WALL;
    tiles[idx(map, width - 1, y)] = TILE.WALL;
  }
  for (const [x, y] of walls) tiles[idx(map, x, y)] = TILE.WALL;

  const player = {
    id: 1,
    kind: 'player',
    x: 2,
    y: 2,
    hp: 20,
    maxHp: 20,
    attackDie: 8,
    glyph: '@',
  };
  const state = {
    status: 'playing',
    turn: 0,
    map,
    vis: { visible: new Uint8Array(width * height), explored: new Uint8Array(width * height) },
    entities: { nextId: 2, playerId: 1, byId: new Map([[1, player]]) },
    items: [],
    path: null,
    prevVisibleEnemies: new Set(),
    log: [],
  };
  return { state, player };
}

describe('turn engine — player movement', () => {
  it('moves onto an open floor tile and consumes a turn', () => {
    const { state, player } = miniState(6, 6);
    const events = processCommand(state, { type: 'move', dx: 0, dy: -1 });
    expect(player.x).toBe(2);
    expect(player.y).toBe(1);
    expect(state.turn).toBe(1);
    expect(events.some((e) => e.type === 'move')).toBe(true);
  });

  it('does not move into a wall and does not consume a turn', () => {
    // Wall directly north of the player at (2,1).
    const { state, player } = miniState(6, 6, [[2, 1]]);
    const events = processCommand(state, { type: 'move', dx: 0, dy: -1 });
    expect(player.x).toBe(2);
    expect(player.y).toBe(2);
    expect(state.turn).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('forbids cutting a diagonal between two wall corners', () => {
    // Destination (3,1) is floor, but both orthogonals (3,2) and (2,1) are wall.
    const { state, player } = miniState(6, 6, [[3, 2], [2, 1]]);
    const blocked = canStep(state, player, 1, -1);
    expect(blocked).toBe(false);
    const events = processCommand(state, { type: 'move', dx: 1, dy: -1 });
    expect(player.x).toBe(2);
    expect(player.y).toBe(2);
    expect(state.turn).toBe(0);
  });

  it('allows a diagonal when at least the path is open on both sides', () => {
    // No corner walls: (3,2) and (2,1) are floor, so NE is legal.
    const { state, player } = miniState(6, 6);
    const ok = canStep(state, player, 1, -1);
    expect(ok).toBe(true);
    processCommand(state, { type: 'move', dx: 1, dy: -1 });
    expect(player.x).toBe(3);
    expect(player.y).toBe(1);
    expect(state.turn).toBe(1);
  });
});

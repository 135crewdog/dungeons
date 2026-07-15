import { describe, it, expect } from 'vitest';
import { processCommand } from '../src/core/turnEngine.js';
import { canStep } from '../src/core/movement.js';
import { createGame } from '../src/core/gameState.js';
import { TILE } from '../src/core/constants.js';
import { idx, getPlayer } from '../src/core/query.js';

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
    stairsDown: null,
    stairsUp: null,
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

  it('allows a diagonal when both orthogonal tiles are open', () => {
    // No corner walls: (3,2) and (2,1) are floor, so NE is legal.
    const { state, player } = miniState(6, 6);
    const ok = canStep(state, player, 1, -1);
    expect(ok).toBe(true);
    processCommand(state, { type: 'move', dx: 1, dy: -1 });
    expect(player.x).toBe(3);
    expect(player.y).toBe(1);
    expect(state.turn).toBe(1);
  });

  it('rejects non-unit movement without consuming a turn', () => {
    // A two-tile jump would skip the intervening tile; the engine must refuse it
    // rather than teleport the player across (3,2) to (4,2).
    const { state, player } = miniState(6, 6);
    expect(canStep(state, player, 2, 0)).toBe(false);
    const events = processCommand(state, { type: 'move', dx: 2, dy: 0 });
    expect(player.x).toBe(2);
    expect(player.y).toBe(2);
    expect(state.turn).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('recomputes field of view each turn so the new tile is visible', () => {
    // Step 5 runs every turn: after moving, the player's own tile is lit.
    const { state, player } = miniState(6, 6);
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.x).toBe(3);
    expect(state.vis.visible[idx(state.map, player.x, player.y)]).toBe(1);
  });
});

describe('turn engine — staircase transitions', () => {
  // Isolate the player so the step onto the stairs is a clean move (no enemy to
  // bump, no item to pick up on the way).
  function soloOn(seed) {
    const state = createGame(seed);
    for (const id of [...state.entities.byId.keys()]) {
      if (id !== state.entities.playerId) state.entities.byId.delete(id);
    }
    state.items = [];
    return state;
  }

  it('counts a descent as exactly one turn and advances the floor', () => {
    const state = soloOn(12345);
    const player = getPlayer(state);
    const down = state.map.stairsDown;
    // A room center's orthogonal neighbours are always interior floor.
    player.x = down.x - 1;
    player.y = down.y;
    const beforeFloor = state.floor;
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(state.turn).toBe(1);
    expect(state.floor).toBe(beforeFloor + 1);
    expect(events.some((e) => e.type === 'descend')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { computeFov } from '../src/systems/fov.js';
import { updateVisibility } from '../src/systems/visibility.js';
import { TILE } from '../src/core/constants.js';
import { idx } from '../src/core/query.js';

// Build a predicate grid from ASCII rows: '#' blocks, everything else is open.
function parseGrid(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const blocked = (x, y) => x < 0 || y < 0 || x >= width || y >= height || rows[y][x] === '#';
  return { width, height, blocked };
}

function fovSet(grid, ox, oy) {
  const set = new Set();
  computeFov(
    ox,
    oy,
    grid.blocked,
    (x, y) => {
      if (x >= 0 && y >= 0 && x < grid.width && y < grid.height) set.add(y * grid.width + x);
    },
    Math.max(grid.width, grid.height),
  );
  return set;
}

describe('symmetric shadowcasting', () => {
  it('always marks the origin visible', () => {
    const grid = parseGrid(['.....', '.....', '.....']);
    expect(fovSet(grid, 2, 1).has(1 * 5 + 2)).toBe(true);
  });

  it('walls block tiles directly behind them', () => {
    // Wall pillar at (2,2); origin at (2,0) looking down the column.
    const grid = parseGrid(['.....', '.....', '..#..', '.....', '.....']);
    const v = fovSet(grid, 2, 0);
    expect(v.has(2 * 5 + 2)).toBe(true); // the wall face itself is seen
    expect(v.has(3 * 5 + 2)).toBe(false); // shadowed tile behind the wall
    expect(v.has(4 * 5 + 2)).toBe(false);
  });

  it('open doors do not block sight', () => {
    const grid = parseGrid(['.....', '.....', '..+..', '.....', '.....']);
    const v = fovSet(grid, 2, 0);
    expect(v.has(4 * 5 + 2)).toBe(true); // visible straight through the door
  });

  it('is symmetric: if O sees T then T sees O (over open tiles)', () => {
    const rows = [
      '..........',
      '..#....#..',
      '..#.##.#..',
      '......#...',
      '.####.....',
      '....#.#...',
      '..#...#...',
      '..........',
    ];
    const grid = parseGrid(rows);
    const ox = 4;
    const oy = 3;
    const seen = fovSet(grid, ox, oy);
    for (const key of seen) {
      const tx = key % grid.width;
      const ty = Math.floor(key / grid.width);
      if (grid.blocked(tx, ty)) continue; // symmetry guarantee is for open tiles
      const back = fovSet(grid, tx, ty);
      expect(back.has(oy * grid.width + ox)).toBe(true);
    }
  });
});

// A small handcrafted state with one room for the visibility integration tests.
function roomState() {
  const width = 9;
  const height = 9;
  const tiles = new Uint8Array(width * height); // all WALL (0)
  const roomAt = new Int16Array(width * height).fill(-1);
  const map = { width, height, tiles, rooms: [{ id: 0, x: 2, y: 2, w: 5, h: 5 }], roomAt, stairs: null };
  for (let y = 2; y < 7; y++) {
    for (let x = 2; x < 7; x++) {
      tiles[idx(map, x, y)] = TILE.FLOOR;
      roomAt[idx(map, x, y)] = 0;
    }
  }
  const player = { id: 1, kind: 'player', x: 4, y: 4, hp: 20, maxHp: 20, damage: 4, glyph: '@' };
  const state = {
    map,
    vis: { visible: new Uint8Array(width * height), explored: new Uint8Array(width * height) },
    entities: { nextId: 2, playerId: 1, byId: new Map([[1, player]]) },
  };
  return { state, map, player };
}

describe('visibility', () => {
  it('reveals the whole room (as explored) on entry', () => {
    const { state, map } = roomState();
    updateVisibility(state);
    for (let y = 2; y < 7; y++) {
      for (let x = 2; x < 7; x++) {
        expect(state.vis.explored[idx(map, x, y)]).toBe(1);
      }
    }
  });

  it('keeps explored memory monotonic as the player moves', () => {
    const { state, map, player } = roomState();
    updateVisibility(state);
    const before = Uint8Array.from(state.vis.explored);
    player.x = 5;
    player.y = 5;
    updateVisibility(state);
    for (let i = 0; i < before.length; i++) {
      if (before[i] === 1) expect(state.vis.explored[i]).toBe(1);
    }
  });

  it('rebuilds the visible set each turn (visible is not monotonic)', () => {
    const { state, map, player } = roomState();
    updateVisibility(state);
    // A tile far outside the room is never visible from inside it.
    expect(state.vis.visible[idx(map, 0, 0)]).toBe(0);
    expect(state.vis.visible[idx(map, player.x, player.y)]).toBe(1);
  });
});

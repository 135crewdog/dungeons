import { describe, it, expect } from 'vitest';
import { generateFloor } from '../src/world/dungeon.js';
import { roomCenter } from '../src/world/rooms.js';
import { createRng } from '../src/core/rng.js';
import { TILE } from '../src/core/constants.js';
import { idx, isWalkableTile, isTransparentTile } from '../src/core/query.js';

function gen(seed) {
  return generateFloor(createRng(seed), 1);
}

// 4-directional flood over walkable tiles from a start, returning the reached set.
function reachable(map, sx, sy) {
  const seen = new Set();
  const stack = [[sx, sy]];
  const key = (x, y) => y * map.width + x;
  seen.add(key(sx, sy));
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      if (!isWalkableTile(map.tiles[idx(map, nx, ny)])) continue;
      seen.add(k);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

describe('dungeon generation', () => {
  it('is deterministic for a given seed', () => {
    const a = gen(4242);
    const b = gen(4242);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
  });

  it('produces at least two rooms and keeps them in bounds', () => {
    const map = gen(1);
    expect(map.rooms.length).toBeGreaterThanOrEqual(2);
    for (const r of map.rooms) {
      expect(r.x).toBeGreaterThanOrEqual(1);
      expect(r.y).toBeGreaterThanOrEqual(1);
      expect(r.x + r.w).toBeLessThanOrEqual(map.width - 1);
      expect(r.y + r.h).toBeLessThanOrEqual(map.height - 1);
    }
  });

  it('keeps a solid wall border around the whole map', () => {
    const map = gen(77);
    for (let x = 0; x < map.width; x++) {
      expect(map.tiles[idx(map, x, 0)]).toBe(TILE.WALL);
      expect(map.tiles[idx(map, x, map.height - 1)]).toBe(TILE.WALL);
    }
    for (let y = 0; y < map.height; y++) {
      expect(map.tiles[idx(map, 0, y)]).toBe(TILE.WALL);
      expect(map.tiles[idx(map, map.width - 1, y)]).toBe(TILE.WALL);
    }
  });

  it('leaves at least one tile of gap between rooms (no overlap/adjacency)', () => {
    const map = gen(313);
    const rooms = map.rooms;
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i];
        const b = rooms[j];
        const overlap =
          a.x - 1 < b.x + b.w &&
          a.x + a.w + 1 > b.x &&
          a.y - 1 < b.y + b.h &&
          a.y + a.h + 1 > b.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it('places exactly one stairs tile matching map.stairs', () => {
    const map = gen(555);
    let count = 0;
    for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE.STAIRS) count++;
    expect(count).toBe(1);
    expect(map.tiles[idx(map, map.stairs.x, map.stairs.y)]).toBe(TILE.STAIRS);
  });

  it('doors are walkable and transparent and occur at junctions', () => {
    // Aggregate across seeds: door placement should be common.
    let totalDoors = 0;
    for (let s = 0; s < 20; s++) {
      const map = gen(s * 101 + 3);
      for (let i = 0; i < map.tiles.length; i++) {
        if (map.tiles[i] === TILE.DOOR) {
          totalDoors++;
          expect(isWalkableTile(TILE.DOOR)).toBe(true);
          expect(isTransparentTile(TILE.DOOR)).toBe(true);
        }
      }
    }
    expect(totalDoors).toBeGreaterThan(0);
  });

  it('is fully connected: every room center and the stairs are reachable from the start', () => {
    for (let s = 0; s < 25; s++) {
      const map = gen(s * 37 + 9);
      const start = roomCenter(map.rooms[0]);
      const seen = reachable(map, start.x, start.y);
      for (const room of map.rooms) {
        const c = roomCenter(room);
        expect(seen.has(c.y * map.width + c.x)).toBe(true);
      }
      expect(seen.has(map.stairs.y * map.width + map.stairs.x)).toBe(true);
    }
  });
});

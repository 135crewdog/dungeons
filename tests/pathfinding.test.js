import { describe, it, expect } from 'vitest';
import { aStar } from '../src/systems/pathfinding.js';

// Passability from ASCII rows: '#' blocks, everything else is open.
function grid(rows) {
  const w = rows[0].length;
  const h = rows.length;
  const passable = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rows[y][x] !== '#';
  return { w, h, passable };
}

describe('A* pathfinding', () => {
  it('finds a straight diagonal on open ground', () => {
    const g = grid(['.....', '.....', '.....', '.....', '.....']);
    const path = aStar(g.passable, { x: 0, y: 0 }, { x: 4, y: 4 }, g.w);
    expect(path).not.toBeNull();
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 4, y: 4 });
    expect(path).toHaveLength(5); // 4 diagonal steps
  });

  it('returns null when the goal is walled off', () => {
    const g = grid(['.....', '.###.', '.#.#.', '.###.', '.....']);
    const path = aStar(g.passable, { x: 0, y: 0 }, { x: 2, y: 2 }, g.w);
    expect(path).toBeNull();
  });

  it('refuses to cut a diagonal between two wall corners', () => {
    // Only a corner-cut connects (0,0) to (1,1); it must be refused → null.
    const g = grid(['.#', '#.']);
    const path = aStar(g.passable, { x: 0, y: 0 }, { x: 1, y: 1 }, g.w);
    expect(path).toBeNull();
  });

  it('routes around a blocked corner instead of cutting it', () => {
    // (0,1) is wall; the NE corner-cut is illegal, so it goes right then down.
    const g = grid(['..', '#.']);
    const path = aStar(g.passable, { x: 0, y: 0 }, { x: 1, y: 1 }, g.w);
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it('treats unexplored (impassable predicate) tiles as blocked', () => {
    // Simulates the click-path predicate: only the marked-open corridor is
    // passable, everything else (unexplored) is blocked.
    const openSet = new Set(['0,0', '1,0', '2,0', '2,1', '2,2']);
    const passable = (x, y) => openSet.has(`${x},${y}`);
    const path = aStar(passable, { x: 0, y: 0 }, { x: 2, y: 2 }, 8);
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toEqual({ x: 2, y: 2 });
    // A tile outside the known-open set must never appear in the path.
    for (const p of path) expect(openSet.has(`${p.x},${p.y}`)).toBe(true);
  });

  it('is deterministic for identical inputs', () => {
    const g = grid(['......', '.####.', '.#..#.', '.#..#.', '......']);
    const a = aStar(g.passable, { x: 0, y: 0 }, { x: 5, y: 4 }, g.w);
    const b = aStar(g.passable, { x: 0, y: 0 }, { x: 5, y: 4 }, g.w);
    expect(a).toEqual(b);
  });
});

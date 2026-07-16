import { describe, it, expect } from 'vitest';
import { diagonalAllowed, isWalkable } from '../src/core/query.js';
import { canStep } from '../src/core/movement.js';
import { aStar } from '../src/systems/pathfinding.js';
import { TILE } from '../src/core/constants.js';
import { createRng, chance } from '../src/core/rng.js';

describe('diagonalAllowed (shared no-corner-cutting rule)', () => {
  const open = () => true;
  it('always allows cardinal steps', () => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      expect(diagonalAllowed(() => false, 5, 5, dx, dy)).toBe(true);
    }
  });

  it('allows a diagonal only when both orthogonal neighbors are passable', () => {
    // Block the tile to the east of (5,5); a NE/SE step past it is illegal.
    const blockedEast = (x, y) => !(x === 6 && y === 5);
    expect(diagonalAllowed(blockedEast, 5, 5, 1, -1)).toBe(false); // NE squeezes past east wall
    expect(diagonalAllowed(blockedEast, 5, 5, 1, 1)).toBe(false); // SE too
    expect(diagonalAllowed(blockedEast, 5, 5, -1, -1)).toBe(true); // NW is clear
    expect(diagonalAllowed(open, 5, 5, 1, 1)).toBe(true); // all clear
  });
});

describe('movement and A* enforce the same corner-cut rule', () => {
  // Both now call diagonalAllowed; this fuzz guards against either re-inlining a
  // divergent copy in the future. Random 4x4 wall grids, every diagonal case.
  it('canStep and a one-tile A* agree on every diagonal on random grids', () => {
    const rng = createRng(31337);
    let checked = 0;
    for (let trial = 0; trial < 400; trial++) {
      const width = 4;
      const height = 4;
      const tiles = new Uint8Array(width * height);
      const map = { width, height, tiles };
      for (let i = 0; i < tiles.length; i++) tiles[i] = chance(rng, 0.6) ? TILE.FLOOR : TILE.WALL;
      const state = { map };
      const passable = (x, y) => isWalkable(map, x, y);
      for (const [dx, dy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        for (let y = 1; y < 3; y++) {
          for (let x = 1; x < 3; x++) {
            if (!isWalkable(map, x, y)) continue;
            const stepOk = canStep(state, { x, y }, dx, dy);
            const path = aStar(passable, { x, y }, { x: x + dx, y: y + dy }, width);
            const aStarDirect = path !== null && path.length === 2;
            expect(stepOk).toBe(aStarDirect);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

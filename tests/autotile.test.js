import { describe, it, expect } from 'vitest';
import { TILE } from '../src/core/constants.js';
import {
  isWallAt,
  wallFacesSouth,
  wallMask4,
  wallMask8,
  variantIndex,
} from '../src/renderer/autotile.js';

// Build a map from an ASCII sketch: '#' = WALL, '.' = FLOOR. Rows must be equal
// length. Mirrors the real map shape { width, height, tiles: Uint8Array }.
function mapFrom(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const tiles = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles[y * width + x] = rows[y][x] === '#' ? TILE.WALL : TILE.FLOOR;
    }
  }
  return { width, height, tiles };
}

describe('autotile masks', () => {
  const map = mapFrom([
    '#####',
    '#...#',
    '#.#.#',
    '#...#',
    '#####',
  ]);

  it('reads out-of-bounds as WALL', () => {
    expect(isWallAt(map, -1, 0)).toBe(true);
    expect(isWallAt(map, 100, 100)).toBe(true);
    expect(isWallAt(map, 2, 2)).toBe(true); // the interior pillar
    expect(isWallAt(map, 1, 1)).toBe(false); // floor
  });

  it('wallMask4 sees no wall neighbours for the lone interior pillar', () => {
    // (2,2) pillar is surrounded by floor on all four sides.
    expect(wallMask4(map, 2, 2)).toBe(0);
  });

  it('wallMask4 flags all four sides deep inside a solid block', () => {
    const solid = mapFrom(['###', '###', '###']);
    expect(wallMask4(solid, 1, 1)).toBe(0b1111);
  });

  it('wallMask4 encodes N/E/S/W in bit order', () => {
    // Center floor cell with a wall only to the north (E/W/S are floor).
    const m = mapFrom(['.#.', '...', '...']);
    expect(wallMask4(m, 1, 1)).toBe(0b0001); // N only
  });

  it('wallFacesSouth is true only when the tile below is open', () => {
    const m = mapFrom(['#', '#', '.']); // (0,0)# over (0,1)# over (0,2).
    expect(wallFacesSouth(m, 0, 0)).toBe(false); // wall below
    expect(wallFacesSouth(m, 0, 1)).toBe(true); // floor below -> shows a face
    expect(wallFacesSouth(m, 0, 2)).toBe(false); // this tile is floor
  });

  it('wallMask8 sets diagonal bits', () => {
    const solid = mapFrom(['###', '###', '###']);
    expect(wallMask8(solid, 1, 1)).toBe(0b11111111);
    // A single wall to the NE only (bit 1).
    const ne = mapFrom(['..#', '...', '...']);
    expect(wallMask8(ne, 1, 1) & 0b10).toBe(0b10);
  });
});

describe('variantIndex', () => {
  it('is deterministic for a position', () => {
    expect(variantIndex(3, 7, 8)).toBe(variantIndex(3, 7, 8));
  });

  it('stays within [0, count)', () => {
    for (let x = 0; x < 30; x++) {
      for (let y = 0; y < 30; y++) {
        const v = variantIndex(x, y, 8);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(8);
      }
    }
  });

  it('returns 0 when there is only one variant', () => {
    expect(variantIndex(5, 9, 1)).toBe(0);
  });

  it('spreads across variants (not all identical)', () => {
    const seen = new Set();
    for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) seen.add(variantIndex(x, y, 8));
    expect(seen.size).toBeGreaterThan(3);
  });
});

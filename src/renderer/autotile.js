// Pure autotiling primitives over the dungeon's dense tile grid. No Phaser: the
// simulation's `map.tiles` is all we need, and `tileAt` reads out-of-bounds as
// WALL so map borders and fogged neighbours never break connectivity. The
// renderer's TileLayer turns these masks into the 2.5D wall frames; keeping the
// math here makes it browser-testable and independent of the art.

import { TILE } from '../core/constants.js';
import { tileAt } from '../core/query.js';

export function isWallAt(map, x, y) {
  return tileAt(map, x, y) === TILE.WALL; // out-of-bounds reads as WALL
}

// A wall tile whose SOUTH neighbour is open (floor/door/stairs) shows a brick
// FACE in the 2.5D model; otherwise only its flat top is visible. This is the
// single most important wall query for the Shattered-Pixel-Dungeon look.
export function wallFacesSouth(map, x, y) {
  return isWallAt(map, x, y) && !isWallAt(map, x, y + 1);
}

// 4-bit cardinal adjacency mask: N=1, E=2, S=4, W=8, bit set when that
// neighbour is a wall. Drives which wall edge/cap piece a tile needs.
export function wallMask4(map, x, y) {
  let m = 0;
  if (isWallAt(map, x, y - 1)) m |= 1;
  if (isWallAt(map, x + 1, y)) m |= 2;
  if (isWallAt(map, x, y + 1)) m |= 4;
  if (isWallAt(map, x - 1, y)) m |= 8;
  return m;
}

// 8-bit mask including diagonals, in DIRS8 order N,NE,E,SE,S,SW,W,NW as bits
// 0..7. Needed to disambiguate inner vs outer corners for wall tops.
export function wallMask8(map, x, y) {
  const off = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ];
  let m = 0;
  for (let i = 0; i < 8; i++) {
    if (isWallAt(map, x + off[i][0], y + off[i][1])) m |= 1 << i;
  }
  return m;
}

// Deterministic, position-only variant index in [0, count). Used to scatter
// floor variants without the seeded game RNG (a renderer concern that must be
// stable every redraw, or floors would shimmer). Integer hash of (x, y).
export function variantIndex(x, y, count) {
  if (count <= 1) return 0;
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) % count;
}

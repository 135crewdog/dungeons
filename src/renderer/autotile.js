// Autotiling for the SPD-style environment spritesheet — a pure JavaScript
// port of Shattered Pixel Dungeon's DungeonTileSheet stitching, reduced to our
// five tile types. The sheet is a 16×16 grid of 16px frames (frame index =
// col + 16*row). Terrain draws in two layers: a GROUND layer under actors
// (floors, stairs, door faces, wall front faces) and a WALLS layer over actors
// (wall tops, overhangs, door lintels) — walls occupy one cell but their tops
// spill into the cell above, which is what sells the pseudo-3D. Everything
// here is a pure function of the map, so it unit-tests without Phaser.

import { TILE } from '../core/constants.js';
import { tileAt } from '../core/query.js';

// Frame indices in tiles_prison.png (identical layout across all SPD
// environment sheets), verified against DungeonTileSheet at commit 7b8b845a.
export const F = Object.freeze({
  FLOOR: 0,
  FLOOR_ALT1: 6, // common variant (~45% of cells)
  FLOOR_ALT2: 12, // rare variant (~5%)
  STAIRS_UP: 16, // SPD "entrance"
  STAIRS_DOWN: 17, // SPD "exit"
  // Wall front faces (ground layer, +1 open right / +2 open left):
  RAISED_WALL: 80,
  RAISED_WALL_DOOR: 88, // wall face framing a sideways doorway below it
  RAISED_WALL_ALT: 96,
  // Door faces (ground layer):
  RAISED_DOOR: 112,
  RAISED_DOOR_OPEN: 113,
  RAISED_DOOR_SIDEWAYS: 116, // floor art under a door set into a N–S wall run
  // Wall tops (walls layer, 16 stitch permutations):
  WALL_INTERNAL: 144,
  // Overhangs — a wall top spilling into the non-wall cell above the wall
  // (walls layer, +1 open below-right / +2 open below-left):
  WALL_OVERHANG: 192,
  DOOR_SIDEWAYS_OVERHANG_OPEN: 208, // sideways door's own top
  DOOR_SIDEWAYS_OVERHANG_CLOSED: 212,
  DOOR_OVERHANG: 224, // cell above a raised door
  DOOR_OVERHANG_OPEN: 225,
  DOOR_SIDEWAYS: 227, // lintel: wall cell directly above a closed sideways door
});

export const NO_FRAME = -1;

// Stable per-cell roll 0..99 for visual variety, replacing SPD's seeded
// tileVariance array. A pure integer hash (not the game RNG — the renderer
// may not touch it, and visuals must never advance gameplay randomness).
// Salted with the floor number so revisited floors re-render identically.
export function variance(x, y, salt) {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x27d4eb2f);
  h ^= h >>> 15;
  return (h >>> 0) % 100;
}

// "Wall-stitcheable" in SPD terms. tileAt reads out-of-bounds as WALL, so the
// map rim stitches as if surrounded by more rock — same as SPD's NULL_TILE.
function wallish(t) {
  return t === TILE.WALL;
}

const noOpenDoors = () => false;

// Ground layer (drawn under items/entities). Returns a frame index or
// NO_FRAME. `isOpen(x, y)` is the renderer's purely-visual predicate for "the
// door at (x, y) is currently open"; the simulation has no open/closed state.
export function groundFrame(map, x, y, salt, isOpen = noOpenDoors) {
  const t = tileAt(map, x, y);

  switch (t) {
    case TILE.FLOOR: {
      const v = variance(x, y, salt);
      if (v >= 95) return F.FLOOR_ALT2;
      if (v >= 50) return F.FLOOR_ALT1;
      return F.FLOOR;
    }
    case TILE.STAIRS_UP:
      return F.STAIRS_UP;
    case TILE.STAIRS_DOWN:
      return F.STAIRS_DOWN;
    case TILE.DOOR: {
      // Door in a N–S wall run (wall above): the doorway faces sideways, so
      // the ground shows floor; the door art lives in the walls layer.
      if (wallish(tileAt(map, x, y - 1))) return F.RAISED_DOOR_SIDEWAYS;
      return isOpen(x, y) ? F.RAISED_DOOR_OPEN : F.RAISED_DOOR;
    }
    case TILE.WALL: {
      const below = tileAt(map, x, y + 1);
      // Interior rock: the walls layer draws this cell's top instead.
      if (wallish(below)) return NO_FRAME;
      // Bottom edge of a wall block: draw the vertical front face. The alt
      // variant applies to the plain face only, and before the edge bits.
      let base;
      if (below === TILE.DOOR) base = F.RAISED_WALL_DOOR;
      else base = variance(x, y, salt) >= 50 ? F.RAISED_WALL_ALT : F.RAISED_WALL;
      if (!wallish(tileAt(map, x + 1, y))) base += 1;
      if (!wallish(tileAt(map, x - 1, y))) base += 2;
      return base;
    }
    default:
      return NO_FRAME;
  }
}

// Walls layer (drawn over entities). Returns a frame index or NO_FRAME.
export function wallsFrame(map, x, y, isOpen = noOpenDoors) {
  const t = tileAt(map, x, y);
  const below = tileAt(map, x, y + 1);
  const openBR = !wallish(tileAt(map, x + 1, y + 1));
  const openBL = !wallish(tileAt(map, x - 1, y + 1));

  if (t === TILE.WALL) {
    if (wallish(below)) {
      // Wall top, stitched to the four neighbors that shape its outline.
      let frame = F.WALL_INTERNAL;
      if (!wallish(tileAt(map, x + 1, y))) frame += 1;
      if (openBR) frame += 2;
      if (openBL) frame += 4;
      if (!wallish(tileAt(map, x - 1, y))) frame += 8;
      return frame;
    }
    // Wall directly above a sideways door: the closed door's lintel.
    if (below === TILE.DOOR) return isOpen(x, y + 1) ? NO_FRAME : F.DOOR_SIDEWAYS;
    return NO_FRAME;
  }

  if (t === TILE.DOOR && wallish(below)) {
    // The sideways door's own cell: its top edge, open or closed.
    const base = isOpen(x, y) ? F.DOOR_SIDEWAYS_OVERHANG_OPEN : F.DOOR_SIDEWAYS_OVERHANG_CLOSED;
    return base + (openBR ? 1 : 0) + (openBL ? 2 : 0);
  }

  // Non-wall cell sitting on top of a wall: the wall's top overhangs into it.
  if (wallish(below)) return F.WALL_OVERHANG + (openBR ? 1 : 0) + (openBL ? 2 : 0);
  // Non-wall cell above a raised door: the doorway's upper edge.
  if (below === TILE.DOOR) return isOpen(x, y + 1) ? F.DOOR_OVERHANG_OPEN : F.DOOR_OVERHANG;

  return NO_FRAME;
}

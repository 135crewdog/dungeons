// Tile↔pixel conversion and integer-zoom math. The only place the renderer
// turns tile coordinates into world pixels. Keeping this isolated means the
// simulation never sees a pixel and input can convert screen→tile via one path.

import { TILE_SIZE } from '../core/constants.js';

// Target on-screen size of a tile, in CSS pixels. Zoom is chosen to hold tiles
// at (about) this size REGARDLESS of screen size — so a bigger screen shows MORE
// tiles, not bigger ones (per the design). Integer zoom keeps the grid crisp.
const TARGET_TILE_CSS = 30;
const MAX_ZOOM = 8;

// Integer zoom for a given device pixel ratio. The render buffer is sized in
// device pixels (see the scene's fitToWindow), so we scale the target by dpr to
// keep the apparent CSS tile size constant while rendering crisply on hi-dpi.
export function computeZoom(dpr = 1) {
  const z = Math.round((TARGET_TILE_CSS * dpr) / TILE_SIZE);
  return Math.max(1, Math.min(z, MAX_ZOOM));
}

// Top-left world pixel of a tile.
export function tileToWorld(tx, ty) {
  return { x: tx * TILE_SIZE, y: ty * TILE_SIZE };
}

// Center world pixel of a tile (used for camera follow).
export function tileCenterWorld(tx, ty) {
  return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
}

// World pixel → tile coordinate.
export function worldToTile(wx, wy) {
  return { x: Math.floor(wx / TILE_SIZE), y: Math.floor(wy / TILE_SIZE) };
}

// How much of a wall cell's art visually belongs to the walkable tile below it.
//
// SPD's pseudo-3D terrain is vertically asymmetric: a wall paints its top over
// the BOTTOM HALF of the open cell above it (WALL_OVERHANG in autotile.js,
// drawn in the walls layer, over actors), while the wall ABOVE an open cell
// contributes nothing into it. So a one-tile-wide east-west corridor only SHOWS
// its top 8px, even though its hit box is the full 16 — the target sits a
// quarter-tile below where the eye puts it, and the player sprite, drawn with
// its feet SPRITE_LIFT above the tile bottom, pokes up into the wall row so
// that clicking a character's head in a corridor lands on solid wall. Rooms
// escape this because only a room's bottom-most floor row carries an overhang.
export const CLICK_SNAP_PX = TILE_SIZE / 2;

// World pixel → the tile a CLICK there meant, given two predicates from the
// scene. Pure, so it unit-tests without Phaser.
//
// Two corrections, both downward, both for the same reason: SPD's art is drawn
// taller than the cell that owns it, so the pixels under the cursor can belong
// to the tile BELOW the one plain arithmetic returns.
//
//  1. Sprite lift. `liftBelow(x, y)` reports how many px a visible entity on
//     (x, y) pokes up into the cell above it — 4 for the 12x15 humanoids, 7 for
//     the 16x18 boss, straight out of spriteOffset. A click in that band is the
//     character, not the floor it is drawn over. This one has to run FIRST and
//     on an otherwise-good click, because in a room the tile over an enemy's
//     head is perfectly walkable: the click used to succeed at the wrong thing,
//     silently turning "attack the boss" into "walk past the boss".
//  2. Wall overhang. A DEAD click in the lower CLICK_SNAP_PX of a wall whose
//     south neighbor is walkable means that neighbor — see CLICK_SNAP_PX.
//
// Everything else is returned untouched, which is what keeps rooms, items and
// open ground behaving exactly as they always have.
// The two corrections have INDEPENDENT gates, so `overhangPx` is a parameter
// rather than a constant: terrain sprites and creature sprites fall back to
// glyphs separately (useSprites vs useEntitySprites), and a run with glyph
// terrain but sprite actors still needs the lift correction while the wall
// overhang no longer exists to compensate for. Pass 0 to disable the wall snap
// — `withinCell` is always < TILE_SIZE, so the test can never fire. With both
// off this degenerates to plain worldToTile.
export function pickClickTile(wx, wy, walkable, liftBelow = () => 0, overhangPx = CLICK_SNAP_PX) {
  const t = worldToTile(wx, wy);
  const withinCell = wy - t.y * TILE_SIZE;

  const lift = liftBelow(t.x, t.y + 1);
  if (lift > 0 && withinCell >= TILE_SIZE - lift) return { x: t.x, y: t.y + 1 };

  if (walkable(t.x, t.y)) return t;
  if (overhangPx > 0 && withinCell >= TILE_SIZE - overhangPx && walkable(t.x, t.y + 1)) {
    return { x: t.x, y: t.y + 1 };
  }
  return t;
}

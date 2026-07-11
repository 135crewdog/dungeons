// Low-wall autotile: drives walls from the tileset's dedicated
// `atlas_walls_low-16x16.png` sheet (12x4 cells of 16x16) instead of hand-placed
// named pieces. Each wall tile picks a cell from its open (floor) neighbours.
//
// The sheet draws walls the Shattered-Pixel-Dungeon way: viewed from the south,
// so a wall that borders floor to its SOUTH shows a lit-capped brick FACE in its
// top half with a floor lip below; walls whose floor is to the north/back are
// plain brick (you see their top). Because the face/edge cells are partly
// transparent (floor shows through the bottom of a face, or the room-side of a
// vertical wall), TileLayer draws a floor tile UNDER every wall — that's what
// closes the old floor/wall gaps.
//
// Cells were decoded straight from the sheet's pixels (see scratch analysis):
//   f9  south-facing face (floor S)      f0  vertical thru (floor E and W)
//   f15 floor-E vertical (room left wall) f13 floor-W vertical (room right wall)
//   f17 floor S+E convex corner           f18 floor S+W convex corner
//   f45 solid brick (interior / back wall)
// This CELL map is the seam — the one place mapping a neighbour config to a cell.

import { TILE } from '../../core/constants.js';
import { tileAt } from '../../core/query.js';

export const WALLS_LOW_KEY = 'walls_low';
const COLS = 12;

// Frame index for a sheet cell (col,row).
export const cell = (c, r) => r * COLS + c;

// Cells decoded from the sheet by their canonical 3×3-minimal signature (which
// neighbours are floor). Crucially the whole set shares one mortar-seam grid, so
// picking matching cells makes rooms read as continuous brickwork:
//   FACE_S   f9  — floor to the S: the south-facing wall FACE (top walls,
//                  corridor north walls). Its cap seams line up with the corners.
//   WALL_W   f31 — floor to the E: a room's WEST/left wall (brick body on the
//                  outer/left, lit face on the room/right). Matches INNER_TL's stub.
//   WALL_E   f30 — floor to the W: a room's EAST/right wall. Matches INNER_TR.
//   VERT_EW  f0  — floor on BOTH sides: a one-tile-thick vertical wall.
//   CONVEX_* f17/f18 — a convex corner (two adjacent open sides).
//   INNER_TL f5  — a room's TOP-LEFT corner (all sides wall, floor at the SE
//                  diagonal only): the top wall turns down into the left wall.
//   INNER_TR f6  — a room's TOP-RIGHT corner (floor at the SW diagonal only).
//   SOLID    f45 — plain brick, no lit face: interior, and every north-facing/back
//                  wall (bottom room walls, bottom corners) — the low-wall sheet
//                  has NO north-facing cells, walls are only ever drawn from the south.
const FACE_S = cell(9, 0);
const WALL_W = cell(7, 2);
const WALL_E = cell(6, 2);
const VERT_EW = cell(0, 0);
const CONVEX_SE = cell(5, 1);
const CONVEX_SW = cell(6, 1);
const INNER_TL = cell(5, 0);
const INNER_TR = cell(6, 0);
const SOLID = cell(9, 3);

function isWall(map, x, y) {
  return tileAt(map, x, y) === TILE.WALL; // OOB reads as WALL
}

export function lowWallFrame(map, x, y) {
  const n = !isWall(map, x, y - 1);
  const e = !isWall(map, x + 1, y);
  const s = !isWall(map, x, y + 1);
  const w = !isWall(map, x - 1, y);
  const se = !isWall(map, x + 1, y + 1);
  const sw = !isWall(map, x - 1, y + 1);

  // Convex corners first (two adjacent open cardinals), then the south-facing
  // face (which also covers the straight top wall), then vertical edges.
  if (s && e && !w && !n) return CONVEX_SE;
  if (s && w && !e && !n) return CONVEX_SW;
  if (s) return FACE_S;                 // any south floor → the wall face
  if (e && w) return VERT_EW;
  if (e) return WALL_W;                  // floor east → room's west wall
  if (w) return WALL_E;                  // floor west → room's east wall
  // No open cardinal: a concave room corner shows through one bottom diagonal;
  // only the two TOP corners have art (the sheet has no north-facing cells), so
  // bottom corners / back walls / interior all fall back to plain brick.
  if (se && !sw) return INNER_TL;        // top-left corner (floor at SE)
  if (sw && !se) return INNER_TR;        // top-right corner (floor at SW)
  return SOLID;
}

// Debug: lay out all 48 cells in a grid with (col,row) labels, at world origin.
// Enabled via ?walldebug so the exact cell for each config can be read off.
export function renderDebugGrid(scene) {
  const S = 3; // scale
  const pad = 24;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < COLS; c++) {
      const px = pad + c * (16 * S + 16);
      const py = pad + r * (16 * S + 26);
      scene.add.rectangle(px - 2, py - 2, 16 * S + 4, 16 * S + 4, 0x11141c).setOrigin(0, 0);
      scene.add.image(px, py, WALLS_LOW_KEY, cell(c, r)).setOrigin(0, 0).setScale(S);
      scene.add
        .text(px, py + 16 * S + 1, `${c},${r}`, { fontFamily: 'monospace', fontSize: '12px', color: '#ffd24a' })
        .setOrigin(0, 0);
    }
  }
  scene.cameras.main.setZoom(1);
  scene.cameras.main.centerOn(pad + COLS * (16 * S + 16) / 2, pad + 4 * (16 * S + 26) / 2);
}

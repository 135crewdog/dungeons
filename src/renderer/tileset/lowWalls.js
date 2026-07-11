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

const FACE_S = cell(9, 0);       // wall with floor to the south — the brick face
const VERT_E = cell(3, 1);       // floor to the east  (room's left/west wall)
const VERT_W = cell(1, 1);       // floor to the west   (room's right/east wall)
const VERT_EW = cell(0, 0);      // floor both sides (a one-tile-thick vertical wall)
const CORNER_SE = cell(5, 1);    // floor south+east (wall wraps the NW)
const CORNER_SW = cell(6, 1);    // floor south+west (wall wraps the NE)
const SOLID = cell(9, 3);        // fully surrounded / back wall — plain brick

function isWall(map, x, y) {
  return tileAt(map, x, y) === TILE.WALL; // OOB reads as WALL
}

export function lowWallFrame(map, x, y) {
  const n = !isWall(map, x, y - 1);
  const e = !isWall(map, x + 1, y);
  const s = !isWall(map, x, y + 1);
  const w = !isWall(map, x - 1, y);

  // Convex corners first (two adjacent open sides), then the dominant
  // south-facing face, then straight vertical edges, then plain brick.
  if (s && e && !w && !n) return CORNER_SE;
  if (s && w && !e && !n) return CORNER_SW;
  if (e && w && !n && !s) return VERT_EW;
  if (s) return FACE_S;                 // any south floor → show the wall face
  if (e && !w) return VERT_E;
  if (w && !e) return VERT_W;
  if (e && w) return VERT_EW;
  return SOLID;                          // no floor south/east/west (or floor only N)
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

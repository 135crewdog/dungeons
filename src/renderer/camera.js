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

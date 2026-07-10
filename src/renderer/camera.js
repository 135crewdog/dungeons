// Tile↔pixel conversion and integer-zoom math. The only place the renderer
// turns tile coordinates into world pixels. Keeping this isolated means the
// simulation never sees a pixel and input can convert screen→tile via one path.

import { TILE_SIZE } from '../core/constants.js';

// Aim for roughly this many tiles across the short screen axis; zoom is the
// integer that gets closest without going under, clamped to a sane range.
const TARGET_SHORT_AXIS_TILES = 20;
const MAX_ZOOM = 6;

export function computeZoom(canvasW, canvasH) {
  const minDim = Math.min(canvasW, canvasH);
  const z = Math.floor(minDim / (TARGET_SHORT_AXIS_TILES * TILE_SIZE));
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

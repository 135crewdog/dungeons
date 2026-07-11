// The tile renderer: draws the dungeon from the 0x72 atlas. Replaces the ASCII
// GlyphGrid. Terrain is static per floor (frames depend only on the map, not on
// the player), so build() creates the sprites once and sync() only updates each
// tile's visibility + tint from the fog each turn — cheap, no per-turn churn.
//
// Walls use a lightweight 2.5D scheme for the Shattered-Pixel-Dungeon look: a
// wall whose SOUTH neighbour is open shows a brick FACE in its own cell with a
// flat TOP cap poking up into the cell above, so walls read as having height;
// all other walls show only their flat top. Everything is 16x16, grid-aligned.

import { TILE, TILE_SIZE } from '../core/constants.js';
import { idx } from '../core/query.js';
import { isWallAt, variantIndex } from './autotile.js';
import {
  ATLAS_KEY,
  FLOOR_FRAMES,
  STAIRS_FRAME,
  WALL_FRAMES,
} from './tileset/manifest.js';

// Tints: currently-lit tiles draw at full colour; remembered (explored but not
// visible) tiles draw dimmed; unseen tiles are hidden.
const LIT = 0xffffff;
const DIM = 0x3a3d52;

// Floor variety, weighted toward the plain tile so the ground reads calm with
// occasional detail (like SPD). Indexed by a stable per-position hash.
const FLOOR_WEIGHTED = [
  FLOOR_FRAMES[0], FLOOR_FRAMES[0], FLOOR_FRAMES[0], FLOOR_FRAMES[0], FLOOR_FRAMES[0],
  FLOOR_FRAMES[1], FLOOR_FRAMES[2], FLOOR_FRAMES[3],
];

function isOpen(map, x, y) {
  return !isWallAt(map, x, y);
}

// Frame for an open tile: stairs get their own art; floors pick a variant.
function openFrame(map, x, y) {
  if (map.tiles[idx(map, x, y)] === TILE.STAIRS) return STAIRS_FRAME;
  return FLOOR_WEIGHTED[variantIndex(x, y, FLOOR_WEIGHTED.length)];
}

// The lit top cap that crowns a wall where a room sits below it. End-capped at
// the horizontal ends of a run so room corners read cleanly.
function capFrame(map, x, y) {
  const wallW = isWallAt(map, x - 1, y);
  const wallE = isWallAt(map, x + 1, y);
  if (!wallW) return WALL_FRAMES.topLeft;
  if (!wallE) return WALL_FRAMES.topRight;
  return WALL_FRAMES.topMid;
}

export class TileLayer {
  constructor(scene) {
    this.scene = scene;
    this.map = null;
    // One entry per tile: the list of sprites owned by that logical tile (a
    // floor is one sprite; a face wall is two — face + raised cap).
    this.byTile = null;
    this.layer = null;
  }

  build(map) {
    this.map = map;
    this.layer = this.scene.add.layer();
    this.layer.setDepth(0);
    this.byTile = new Array(map.width * map.height);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = idx(map, x, y);
        const sprites = [];
        if (isOpen(map, x, y)) {
          sprites.push(this.place(x, y, openFrame(map, x, y)));
        } else {
          // Every wall shows a solid brick face so rooms read as brick boxes
          // (no gaps). Walls with open floor to the SOUTH additionally get a
          // lit top cap raised one tile above them — the 2.5D "height" edge.
          sprites.push(this.place(x, y, WALL_FRAMES.face));
          if (isOpen(map, x, y + 1)) {
            sprites.push(this.place(x, y - 1, capFrame(map, x, y)));
          }
        }
        for (const s of sprites) s.setVisible(false);
        this.byTile[i] = sprites;
      }
    }
  }

  place(x, y, frame) {
    const img = this.scene.add
      .image(x * TILE_SIZE, y * TILE_SIZE, ATLAS_KEY, frame)
      .setOrigin(0, 0);
    this.layer.add(img);
    return img;
  }

  destroy() {
    if (this.layer) this.layer.destroy();
    this.layer = null;
    this.byTile = null;
  }

  // Repaint fog: each tile lit / remembered-dim / hidden, from state.vis.
  sync(state) {
    const map = state.map;
    const { visible, explored } = state.vis;
    for (let i = 0; i < this.byTile.length; i++) {
      const sprites = this.byTile[i];
      if (!sprites) continue;
      let tint;
      if (visible[i]) tint = LIT;
      else if (explored[i]) tint = DIM;
      else {
        for (const s of sprites) s.setVisible(false);
        continue;
      }
      for (const s of sprites) {
        s.setTint(tint);
        s.setVisible(true);
      }
    }
  }
}

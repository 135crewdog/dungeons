// The tile renderer: draws the dungeon from the 0x72 atlas. Replaces the ASCII
// GlyphGrid. Terrain is static per floor (frames depend only on the map, not on
// the player), so build() creates the sprites once and sync() only updates each
// tile's visibility + tint from the fog each turn — cheap, no per-turn churn.
//
// Walls come from the dedicated low-wall autotile (see tileset/lowWalls.js): a
// single 16x16 cell per wall tile, chosen by its floor neighbours, drawn the
// Shattered-Pixel-Dungeon way (south-facing brick faces, plain brick behind).
// Every wall also gets a plain floor tile drawn UNDER it so the face's floor
// lip and the room-side of vertical walls show floor, not void — no gaps.

import { TILE, TILE_SIZE } from '../core/constants.js';
import { idx } from '../core/query.js';
import { isWallAt, variantIndex } from './autotile.js';
import { ATLAS_KEY, FLOOR_FRAMES, STAIRS_FRAME } from './tileset/manifest.js';
import { WALLS_LOW_KEY, lowWallFrame } from './tileset/lowWalls.js';

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

export class TileLayer {
  constructor(scene) {
    this.scene = scene;
    this.map = null;
    // One entry per tile: the list of sprites owned by that logical tile (a
    // floor is one sprite; a wall is two — a floor base plus the wall cell on
    // top). All sprites of a tile share its fog visibility/tint.
    this.byTile = null;
    this.layer = null;
    this.stairsSprite = null; // exposed so FX can shimmer the exit
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
          const s = this.placeAtlas(x, y, openFrame(map, x, y));
          if (map.tiles[i] === TILE.STAIRS) this.stairsSprite = s;
          sprites.push(s);
        } else {
          // Floor base under the wall (fills the face's lip / the room-side of
          // vertical walls), then the autotiled wall cell on top.
          sprites.push(this.placeAtlas(x, y, FLOOR_FRAMES[0]));
          sprites.push(this.placeWall(x, y, lowWallFrame(map, x, y)));
        }
        for (const s of sprites) s.setVisible(false);
        this.byTile[i] = sprites;
      }
    }
  }

  placeAtlas(x, y, frame) {
    const img = this.scene.add
      .image(x * TILE_SIZE, y * TILE_SIZE, ATLAS_KEY, frame)
      .setOrigin(0, 0);
    this.layer.add(img);
    return img;
  }

  placeWall(x, y, frameIndex) {
    const img = this.scene.add
      .image(x * TILE_SIZE, y * TILE_SIZE, WALLS_LOW_KEY, frameIndex)
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

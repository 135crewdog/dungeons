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

// A wall's appearance follows the 0x72 2.5D model (per the art reference):
//   • Horizontal walls (a room to the N or S) are BRICK WITH A TOP — a brick
//     face plus a lit tan cap. A wall facing a room to the south raises its cap
//     one tile up so it reads tall; a wall backing a room to the north caps its
//     own top edge.
//   • Vertical walls (a room to the E or W) are TOP ONLY — the tan top surface,
//     no brick face (you look down their length, never at a face).
//   • Deep/interior walls are plain brick (rarely seen through the fog).
function wallSprites(map, x, y) {
  const F = (a, b) => !isWallAt(map, a, b); // open (floor/door/stairs)?
  const oN = F(x, y - 1);
  const oS = F(x, y + 1);
  const oE = F(x + 1, y);
  const oW = F(x - 1, y);
  if (oS) {
    // North wall of a room to the south: brick face + a raised lit cap. The cap
    // terminates with a corner piece where the horizontal run ends (no adjacent
    // north-wall = a floor tile is NOT below the neighbour).
    const leftEnd = !F(x - 1, y + 1);
    const rightEnd = !F(x + 1, y + 1);
    const cap = leftEnd ? WALL_FRAMES.topLeft : rightEnd ? WALL_FRAMES.topRight : WALL_FRAMES.topMid;
    return [{ x, y, frame: WALL_FRAMES.face }, { x, y: y - 1, frame: cap }];
  }
  if (oN) {
    // South wall of a room to the north: brick with a lit top edge.
    return [{ x, y, frame: WALL_FRAMES.face }, { x, y, frame: WALL_FRAMES.topMid }];
  }
  // Vertical side walls (tan top only) — including the corner tiles above/below
  // a room, where the column continues past the floor's extent to meet the cap.
  // A room to the east (floor on the E side, cardinal or diagonal) → left column.
  if (oE || F(x + 1, y + 1) || F(x + 1, y - 1)) return [{ x, y, frame: WALL_FRAMES.edgeRight }];
  if (oW || F(x - 1, y + 1) || F(x - 1, y - 1)) return [{ x, y, frame: WALL_FRAMES.edgeLeft }];
  return [{ x, y, frame: WALL_FRAMES.face }];
}

export class TileLayer {
  constructor(scene) {
    this.scene = scene;
    this.map = null;
    // One entry per tile: the list of sprites owned by that logical tile (a
    // floor is one sprite; a face wall is two — face + raised cap).
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
          const s = this.place(x, y, openFrame(map, x, y));
          if (map.tiles[i] === TILE.STAIRS) this.stairsSprite = s;
          sprites.push(s);
        } else {
          // A 2.5D wall: a lit outline around brick, chosen from open neighbours.
          for (const s of wallSprites(map, x, y)) sprites.push(this.place(s.x, s.y, s.frame));
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

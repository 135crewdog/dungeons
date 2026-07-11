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

// Wall roles in the 0x72 2.5D model (per the art reference):
//   FRONT   — a room to the SOUTH: brick FACE + a lit tan cap raised one tile
//             up, so it reads tall.
//   SIDE_W  — the LEFT/west wall of a room (room to the east): tan top only,
//             bright tan on the outer (left) edge.
//   SIDE_E  — the RIGHT/east wall of a room (room to the west): tan top, bright
//             tan on the right.
//   SOUTH   — a room to the NORTH: brick with a lit top edge.
//   INTERIOR— deep brick, rarely seen through the fog.
const WT = Object.freeze({ FRONT: 1, SIDE_W: 2, SIDE_E: 3, SOUTH: 4, INTERIOR: 5 });

// Classify every wall tile once. Side (tan) columns are then GROWN vertically
// through interior tiles so a tan wall runs the full height of a thick wall,
// right up to the cap row — that's what makes room corners read as a continuous
// tan outline instead of turning to brick partway up.
function classifyWalls(map) {
  const { width, height } = map;
  const F = (x, y) => !isWallAt(map, x, y);
  const cls = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (F(x, y)) continue; // floor
      const i = y * width + x;
      // Cardinal neighbours decide the wall's role first; a diagonal-only floor
      // marks a corner tile that extends a side column. (Checking diagonals
      // before cardinals would wrongly turn a south wall — whose room sits to
      // the NE/NW — into a tan side wall.)
      if (F(x, y + 1)) cls[i] = WT.FRONT;
      else if (F(x + 1, y)) cls[i] = WT.SIDE_W;
      else if (F(x - 1, y)) cls[i] = WT.SIDE_E;
      else if (F(x, y - 1)) cls[i] = WT.SOUTH;
      else if (F(x + 1, y + 1) || F(x + 1, y - 1)) cls[i] = WT.SIDE_W;
      else if (F(x - 1, y + 1) || F(x - 1, y - 1)) cls[i] = WT.SIDE_E;
      else cls[i] = WT.INTERIOR;
    }
  }
  // Grow the tan side columns up/down through interior brick (never through a
  // FRONT/SOUTH horizontal wall, which stays brick).
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (cls[i] !== WT.INTERIOR) continue;
        const up = y > 0 ? cls[i - width] : 0;
        const down = y < height - 1 ? cls[i + width] : 0;
        if (up === WT.SIDE_W || down === WT.SIDE_W) { cls[i] = WT.SIDE_W; changed = true; }
        else if (up === WT.SIDE_E || down === WT.SIDE_E) { cls[i] = WT.SIDE_E; changed = true; }
      }
    }
  }
  return cls;
}

function wallSprites(map, cls, x, y) {
  const F = (a, b) => !isWallAt(map, a, b);
  switch (cls[idx(map, x, y)]) {
    case WT.FRONT: {
      // Brick face + a raised lit cap; the cap terminates with a corner piece
      // where the horizontal run ends (no north-wall continues to the side).
      const leftEnd = !F(x - 1, y + 1);
      const rightEnd = !F(x + 1, y + 1);
      const cap = leftEnd ? WALL_FRAMES.topLeft : rightEnd ? WALL_FRAMES.topRight : WALL_FRAMES.topMid;
      return [{ x, y, frame: WALL_FRAMES.face }, { x, y: y - 1, frame: cap }];
    }
    case WT.SOUTH:
      return [{ x, y, frame: WALL_FRAMES.face }, { x, y, frame: WALL_FRAMES.topMid }];
    case WT.SIDE_W:
      // Room is to the EAST → tan faces the room on the right.
      return [{ x, y, frame: WALL_FRAMES.edgeMidRight }];
    case WT.SIDE_E:
      // Room is to the WEST → tan faces the room on the left.
      return [{ x, y, frame: WALL_FRAMES.edgeMidLeft }];
    default:
      return [{ x, y, frame: WALL_FRAMES.face }];
  }
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
    const cls = classifyWalls(map);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = idx(map, x, y);
        const sprites = [];
        if (isOpen(map, x, y)) {
          const s = this.place(x, y, openFrame(map, x, y));
          if (map.tiles[i] === TILE.STAIRS) this.stairsSprite = s;
          sprites.push(s);
        } else {
          // A 2.5D wall: a lit outline around brick, from the wall classification.
          for (const s of wallSprites(map, cls, x, y)) sprites.push(this.place(s.x, s.y, s.frame));
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

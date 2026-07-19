// Sprite terrain from the SPD prison tilesheet: the sprite twin of
// GlyphGrid, with the same build/sync/destroy shape so the scene can swap
// between them. Each cell owns two Images — one in the ground layer (floors,
// stairs, door faces, wall front faces; under actors) and one in the walls
// layer (wall tops, overhangs, door lintels; OVER actors — standing directly
// below a wall you are partially occluded by its top: that is the SPD
// pseudo-3D, not a bug). Frames are recomputed from state on every sync, so
// nothing here can go stale.

import { TILE, TILE_SIZE } from '../core/constants.js';
import { idx, tileAt, entitiesSorted } from '../core/query.js';
import { groundFrame, wallsFrame, NO_FRAME } from './autotile.js';
import { SPRITE_DIM } from './tileStyle.js';

export const TILESHEET_KEY = 'tiles';

function wallish(t) {
  return t === TILE.WALL;
}

export class SpriteTileGrid {
  constructor(scene) {
    this.scene = scene;
    this.map = null;
    this.ground = null;
    this.walls = null;
  }

  build(map) {
    this.map = map;
    const n = map.width * map.height;
    this.ground = new Array(n);
    this.walls = new Array(n);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = idx(map, x, y);
        this.ground[i] = this.makeImage(x, y, this.scene.groundLayer);
        this.walls[i] = this.makeImage(x, y, this.scene.wallsLayer);
      }
    }
  }

  makeImage(x, y, layer) {
    const img = this.scene.add
      .image(x * TILE_SIZE, y * TILE_SIZE, TILESHEET_KEY, 0)
      .setOrigin(0, 0)
      .setVisible(false);
    layer.add(img);
    return img;
  }

  destroy() {
    if (!this.ground) return;
    for (const img of this.ground) img.destroy();
    for (const img of this.walls) img.destroy();
    this.ground = null;
    this.walls = null;
  }

  // Repaint every cell's two layers from current state: lit if visible,
  // grey-dimmed if only remembered, hidden if never seen. Doors draw open —
  // purely visually; the sim has no door state — while an entity stands in
  // them, since frames are recomputed here every repaint anyway.
  sync(state) {
    const map = state.map;
    const { visible, explored } = state.vis;
    const salt = state.floor;

    const occupied = new Set();
    for (const e of entitiesSorted(state)) occupied.add(idx(map, e.x, e.y));
    const isOpen = (x, y) => occupied.has(idx(map, x, y));

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = idx(map, x, y);
        this.apply(this.ground[i], groundFrame(map, x, y, salt, isOpen), visible, explored, i);
        // Overhang art on a floor/stairs cell is the top of the wall BELOW
        // it, so it lights by that wall's visibility — a remembered wall
        // keeps its cap even while the floor strip above it is unexplored,
        // and never leaks the existence of unseen walls.
        const wf = wallsFrame(map, x, y, isOpen);
        const t = map.tiles[i];
        const overhang =
          wf !== NO_FRAME && t !== TILE.WALL && t !== TILE.DOOR && wallish(tileAt(map, x, y + 1));
        this.apply(this.walls[i], wf, visible, explored, overhang ? i + map.width : i);
      }
    }
  }

  apply(img, frame, visible, explored, visIdx) {
    if (frame === NO_FRAME || (!visible[visIdx] && !explored[visIdx])) {
      img.setVisible(false);
      return;
    }
    img.setFrame(frame);
    if (visible[visIdx]) img.clearTint();
    else img.setTint(SPRITE_DIM);
    img.setVisible(true);
  }
}

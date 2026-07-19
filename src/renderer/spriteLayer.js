// Sprite terrain from the SPD prison tilesheet: the sprite twin of
// GlyphGrid, with the same build/sync/destroy shape so the scene can swap
// between them. Frames are recomputed from state on every sync, so nothing
// here can go stale. (Ground layer only so far: floors, stairs, door faces,
// wall front faces. Wall tops/overhangs land in the walls layer next.)

import { TILE_SIZE } from '../core/constants.js';
import { idx } from '../core/query.js';
import { groundFrame, NO_FRAME } from './autotile.js';
import { SPRITE_DIM } from './tileStyle.js';

export const TILESHEET_KEY = 'tiles';

export class SpriteTileGrid {
  constructor(scene) {
    this.scene = scene;
    this.map = null;
    this.ground = null;
  }

  build(map) {
    this.map = map;
    this.ground = new Array(map.width * map.height);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        this.ground[idx(map, x, y)] = this.makeImage(x, y, this.scene.groundLayer);
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
    this.ground = null;
  }

  // Repaint every cell from current state: lit if visible, grey-dimmed if
  // only remembered, hidden if never seen.
  sync(state) {
    const map = state.map;
    const { visible, explored } = state.vis;
    const salt = state.floor;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = idx(map, x, y);
        this.apply(this.ground[i], groundFrame(map, x, y, salt), visible, explored, i);
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

// ASCII glyphs rendered as tinted textures. Each character is baked once into a
// white-on-transparent canvas texture at native tile resolution; tiles then
// draw as lightweight tinted Images. White + per-tile tint lets one texture
// serve any color (lit, dimmed, entity), and pixelArt keeps it crisp under
// integer zoom.
//
// The per-tile drawing decisions (which texture, which tint, whether to hide)
// now live in a painter (see painter.js) so the grid can render either the
// ASCII glyphs or the pixel sprites without changing this traversal. The grid
// still owns the one-Image-per-tile buffer and the visibility read from state.

import { TILE_SIZE } from '../core/constants.js';
import { idx } from '../core/query.js';
import { ALL_GLYPHS, VIS } from './tileStyle.js';

const FONT_PX = 16;

export function glyphKey(ch) {
  return 'glyph:' + ch;
}

// Pre-bake a texture for every glyph the renderer can draw.
export function createGlyphTextures(scene) {
  for (const ch of ALL_GLYPHS) {
    const key = glyphKey(ch);
    if (scene.textures.exists(key)) continue;
    const tex = scene.textures.createCanvas(key, TILE_SIZE, TILE_SIZE);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${FONT_PX}px "DejaVu Sans Mono", "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, TILE_SIZE / 2, TILE_SIZE / 2 + 1);
    tex.refresh();
  }
}

// A full-map grid of tile Images. One Image per tile is fine here: Images are
// cheap batched quads (unlike Text), and the map is bounded. Camera zoom +
// follow decide what's on screen. sync() repaints from state each turn, handing
// each seen tile to the active painter; unseen tiles are simply hidden.
export class GlyphGrid {
  // `layer` is a persistent bottom layer the tiles live in, so a rebuild (floor
  // change or art-style switch) re-adds tiles beneath the item/entity layers
  // instead of on top of them — which matters once tiles are opaque sprites.
  constructor(scene, painter, layer) {
    this.scene = scene;
    this.painter = painter;
    this.layer = layer;
    this.map = null;
    this.images = null;
  }

  build(map) {
    this.map = map;
    this.images = new Array(map.width * map.height);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const img = this.painter.newTileImage(this.scene, x * TILE_SIZE, y * TILE_SIZE);
        this.layer.add(img);
        this.images[idx(map, x, y)] = img;
      }
    }
  }

  destroy() {
    if (!this.images) return;
    for (const img of this.images) img.destroy();
    this.images = null;
  }

  // Repaint every tile at its current visibility: painted (lit or dimmed) if
  // visible/remembered, hidden if never seen.
  sync(state) {
    const map = state.map;
    const { visible, explored } = state.vis;
    for (let i = 0; i < map.tiles.length; i++) {
      const img = this.images[i];
      let vis;
      if (visible[i]) vis = VIS.VISIBLE;
      else if (explored[i]) vis = VIS.EXPLORED;
      else {
        img.setVisible(false);
        continue;
      }
      this.painter.paintTile(img, map.tiles[i], vis);
    }
  }
}

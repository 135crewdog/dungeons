// Sprite terrain from the SPD prison tilesheet: the sprite twin of
// GlyphGrid, with the same build/sync/destroy shape so the scene can swap
// between them. Each cell owns two Images — one in the ground layer (floors,
// stairs, door faces, wall front faces; under actors) and one in the walls
// layer (wall tops, overhangs, door lintels; OVER actors — standing directly
// below a wall you are partially occluded by its top: that is the SPD
// pseudo-3D, not a bug). Frames are recomputed from state on every sync, so
// nothing here can go stale.

import { TILE, TILE_SIZE } from '../core/constants.js';
import { idx, tileAt, entitiesSorted, getPlayer } from '../core/query.js';
import { groundFrame, wallsFrame, wallCapAnchored, NO_FRAME } from './autotile.js';
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
    // Last-applied (frame, lighting) per cell per layer — see apply(). A floor
    // is ~3200 cells, so a full repaint is 6400 Phaser writes; almost none of
    // them differ from one turn to the next, and at auto-walk pace that work
    // competes with the move glide for the frame budget.
    this.groundSig = null;
    this.wallsSig = null;
  }

  build(map) {
    this.map = map;
    const n = map.width * map.height;
    this.ground = new Array(n);
    this.walls = new Array(n);
    // 0 means "hidden", which is exactly how makeImage leaves each Image, so
    // the zero-filled cache starts out truthful.
    this.groundSig = new Int32Array(n);
    this.wallsSig = new Int32Array(n);
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
    this.groundSig = null;
    this.wallsSig = null;
  }

  // Repaint every cell's two layers from current state: lit if visible,
  // grey-dimmed if only remembered, hidden if never seen. Doors draw open —
  // purely visually; the sim has no door state — while an entity stands in
  // them, since frames are recomputed here every repaint anyway.
  sync(state) {
    const map = state.map;
    const { visible, explored } = state.vis;
    const salt = state.floor;
    // Ring of Sight: render the whole floor fully lit (presentation only —
    // the sim's arrays are untouched; apply() reads this flag).
    this.sightAll = getPlayer(state)?.ringSight ?? false;

    // Doors render open while an entity stands in them — but only in a cell the
    // player can currently SEE. A merely-remembered doorway that repainted from
    // live entity positions would swing open and shut across the map as an
    // unseen enemy walked through it, which is a position leak: doors are
    // deliberately opaque (isTransparentTile excludes DOOR) so that what is in a
    // doorway is unknowable until you stand in it, and syncEntities already
    // hides out-of-view enemies. The Ring of Sight lights the floor, so it sees
    // door state too — consistent with what it grants everywhere else.
    const occupied = new Set();
    for (const e of entitiesSorted(state)) occupied.add(idx(map, e.x, e.y));
    const isOpen = (x, y) => {
      const i = idx(map, x, y);
      return occupied.has(i) && (this.sightAll || !!visible[i]);
    };

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = idx(map, x, y);
        const t = map.tiles[i];
        // Wall art (tops, lintels, front faces — and the overhang a wall
        // casts into the open cell above it) renders only when the wall is
        // anchored to an explored open neighbor. Shadowcasting and the room
        // reveal ring mark lone wall cells explored, and an unanchored
        // wall's art would float detached in unexplored black.
        const wf0 = wallsFrame(map, x, y, isOpen);
        const overhang =
          wf0 !== NO_FRAME && t !== TILE.WALL && t !== TILE.DOOR && wallish(tileAt(map, x, y + 1));
        let anchored = true;
        if (t === TILE.WALL) anchored = wallCapAnchored(map, explored, x, y);
        else if (overhang) anchored = wallCapAnchored(map, explored, x, y + 1);
        const gf = t === TILE.WALL && !anchored ? NO_FRAME : groundFrame(map, x, y, salt, isOpen);
        this.apply(this.ground[i], gf, visible, explored, i, this.groundSig, i);
        // Overhang art on a floor/stairs cell is the top of the wall BELOW
        // it, so it lights by that wall's visibility — a remembered wall
        // keeps its cap even while the floor strip above it is unexplored,
        // and never leaks the existence of unseen walls.
        const wf = anchored ? wf0 : NO_FRAME;
        this.apply(
          this.walls[i],
          wf,
          visible,
          explored,
          overhang ? i + map.width : i,
          this.wallsSig,
          i,
        );
      }
    }
  }

  // Draw one cell's layer, skipping the Phaser calls when nothing about it
  // changed. `sig`/`si` address this layer's memo slot; the signature packs
  // everything apply() can produce — hidden, or a frame plus whether it is lit
  // or dimmed — so an unchanged signature provably means unchanged output.
  // The Ring of Sight needs no special handling: it only ever moves a cell
  // between dimmed and lit, which the signature already encodes.
  apply(img, frame, visible, explored, visIdx, sig, si) {
    const hidden = frame === NO_FRAME || (!this.sightAll && !visible[visIdx] && !explored[visIdx]);
    const lit = this.sightAll || visible[visIdx];
    const next = hidden ? 0 : 1 + frame * 2 + (lit ? 1 : 0);
    if (sig[si] === next) return;
    sig[si] = next;
    if (hidden) {
      img.setVisible(false);
      return;
    }
    img.setFrame(frame);
    if (lit) img.clearTint();
    else img.setTint(SPRITE_DIM);
    img.setVisible(true);
  }
}

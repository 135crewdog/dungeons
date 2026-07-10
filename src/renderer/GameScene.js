import Phaser from 'phaser';
import { getPlayer, entitiesSorted, isVisible, isExplored } from '../core/query.js';
import { EV } from '../core/events.js';
import { GlyphGrid, createGlyphTextures, glyphKey } from './glyphLayer.js';
import { computeZoom, tileToWorld, tileCenterWorld, worldToTile } from './camera.js';
import { entityGlyph, entityColor, itemGlyph, itemColor, scaleColor } from './tileStyle.js';
import { spawnFloatingText } from './floatingText.js';

// The one Phaser scene. It OBSERVES the game state and draws it — glyph grid,
// items, entities — and follows the player with an integer-zoomed camera. It
// never mutates the simulation. render() is the single "state changed, repaint"
// entry point the input layer calls after each turn.
export class DungeonScene extends Phaser.Scene {
  constructor() {
    super('dungeon');
  }

  create() {
    this.state = this.registry.get('state');
    createGlyphTextures(this);

    this.grid = new GlyphGrid(this);
    this.grid.build(this.state.map);

    // Items under entities under nothing; the grid is beneath both.
    this.itemLayer = this.add.layer();
    this.entityLayer = this.add.layer();
    this.itemImages = new Map();
    this.entityImages = new Map();

    this.cameras.main.setBackgroundColor('#05060a');
    this.cameras.main.setRoundPixels(true);
    this.applyZoom();

    // Let the composition root reach the scene to repaint and to convert
    // pointer coordinates to tiles.
    this.registry.set('scene', this);

    this.render();
    this.scale.on('resize', this.onResize, this);
  }

  applyZoom() {
    this.cameras.main.setZoom(computeZoom(this.scale.width, this.scale.height));
  }

  onResize() {
    this.applyZoom();
    this.centerOnPlayer();
  }

  // Discard the current floor's visuals and draw a freshly generated one.
  rebuildFloor() {
    this.grid.destroy();
    this.grid = new GlyphGrid(this);
    this.grid.build(this.state.map);
    for (const img of this.itemImages.values()) img.destroy();
    for (const img of this.entityImages.values()) img.destroy();
    this.itemImages.clear();
    this.entityImages.clear();
    this.render();
  }

  // Repaint everything from current state and recenter the camera.
  render() {
    this.grid.sync(this.state);
    this.syncItems();
    this.syncEntities();
    this.centerOnPlayer();
  }

  centerOnPlayer() {
    const p = getPlayer(this.state);
    if (!p) return;
    const c = tileCenterWorld(p.x, p.y);
    this.cameras.main.centerOn(c.x, c.y);
  }

  // Play transient effects from a turn's event list (floating combat numbers).
  playEvents(events) {
    for (const ev of events) {
      if (ev.type !== EV.ATTACK) continue;
      if (ev.hit) spawnFloatingText(this, ev.x, ev.y, `-${ev.damage}`, '#ff5566');
      else spawnFloatingText(this, ev.x, ev.y, 'Miss!', '#aab2c4');
    }
  }

  syncItems() {
    const alive = new Set();
    for (const item of this.state.items) {
      alive.add(item.id);
      let img = this.itemImages.get(item.id);
      if (!img) {
        img = this.add.image(0, 0, glyphKey(itemGlyph(item))).setOrigin(0, 0);
        this.itemLayer.add(img);
        this.itemImages.set(item.id, img);
      }
      const w = tileToWorld(item.x, item.y);
      img.setPosition(w.x, w.y);
      // Remembered while explored; full color only when currently visible.
      const seen = isExplored(this.state, item.x, item.y);
      const lit = isVisible(this.state, item.x, item.y);
      img.setVisible(seen);
      img.setTint(lit ? itemColor(item) : scaleColor(itemColor(item), 0.32));
    }
    for (const [id, img] of this.itemImages) {
      if (!alive.has(id)) {
        img.destroy();
        this.itemImages.delete(id);
      }
    }
  }

  syncEntities() {
    const alive = new Set();
    const playerId = this.state.entities.playerId;
    for (const e of entitiesSorted(this.state)) {
      alive.add(e.id);
      let img = this.entityImages.get(e.id);
      if (!img) {
        img = this.add.image(0, 0, glyphKey(entityGlyph(e))).setOrigin(0, 0);
        this.entityLayer.add(img);
        this.entityImages.set(e.id, img);
      }
      img.setTexture(glyphKey(entityGlyph(e)));
      img.setTint(entityColor(e));
      const w = tileToWorld(e.x, e.y);
      img.setPosition(w.x, w.y);
      // The player is always shown; enemies only when currently in view.
      img.setVisible(e.id === playerId || isVisible(this.state, e.x, e.y));
    }
    for (const [id, img] of this.entityImages) {
      if (!alive.has(id)) {
        img.destroy();
        this.entityImages.delete(id);
      }
    }
  }

  // Canvas/screen pixel → tile coordinate, for click/tap input.
  screenToTile(screenX, screenY) {
    const p = this.cameras.main.getWorldPoint(screenX, screenY);
    return worldToTile(p.x, p.y);
  }
}

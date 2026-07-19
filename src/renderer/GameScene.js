import Phaser from 'phaser';
import { getPlayer, entitiesSorted, isVisible, isExplored } from '../core/query.js';
import { EV } from '../core/events.js';
import { GlyphGrid, createGlyphTextures, glyphKey } from './glyphLayer.js';
import { computeZoom, tileToWorld, tileCenterWorld, worldToTile } from './camera.js';
import {
  entityGlyph,
  entityColor,
  itemGlyph,
  itemColor,
  scaleColor,
  FLOAT_COLOR,
  BG_COLOR,
} from './tileStyle.js';
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

    // Persistent, explicitly depth-ordered layers: terrain under items under
    // entities under wall tops (the walls layer draws OVER actors — that
    // occlusion is the SPD pseudo-3D; it stays empty in ASCII mode). Explicit
    // depths, not add-order, so rebuildFloor can never scramble stacking.
    this.groundLayer = this.add.layer().setDepth(0);
    this.itemLayer = this.add.layer().setDepth(10);
    this.entityLayer = this.add.layer().setDepth(20);
    this.wallsLayer = this.add.layer().setDepth(30);

    this.grid = new GlyphGrid(this);
    this.grid.build(this.state.map);

    this.itemImages = new Map();
    this.entityImages = new Map();

    this.cameras.main.setBackgroundColor(BG_COLOR);
    this.cameras.main.setRoundPixels(true);
    this.renderRatio = 1;
    this.fitToWindow();

    // Let the composition root reach the scene to repaint and to convert
    // pointer coordinates to tiles.
    this.registry.set('scene', this);

    this.render();

    // Scale.NONE means we own the sizing: keep the device-pixel buffer, the CSS
    // display size, and the integer zoom in sync with the window.
    this.onWindowResize = () => {
      this.fitToWindow();
      this.centerOnPlayer();
    };
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('orientationchange', this.onWindowResize);
    this.events.once('shutdown', () => {
      window.removeEventListener('resize', this.onWindowResize);
      window.removeEventListener('orientationchange', this.onWindowResize);
    });
  }

  // Render at device resolution (crisp on hi-dpi), display at CSS size, and pick
  // an integer zoom that holds tiles at a roughly constant on-screen size.
  fitToWindow() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.renderRatio = dpr;
    const cssW = Math.max(1, Math.floor(window.innerWidth));
    const cssH = Math.max(1, Math.floor(window.innerHeight));
    const bufW = Math.floor(cssW * dpr);
    const bufH = Math.floor(cssH * dpr);
    this.scale.resize(bufW, bufH);
    const canvas = this.game.canvas;
    if (canvas) {
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
    }
    this.cameras.resize(bufW, bufH);
    this.cameras.main.setZoom(computeZoom(dpr));
  }

  // Discard the current floor's visuals and draw a freshly generated one.
  // The depth layers persist; only their contents are rebuilt.
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

  // Play transient effects from a turn's event list (floating numbers).
  playEvents(events) {
    for (const ev of events) {
      if (ev.type === EV.ATTACK) {
        if (ev.hit) spawnFloatingText(this, ev.x, ev.y, `-${ev.damage}`, FLOAT_COLOR.damage);
        else spawnFloatingText(this, ev.x, ev.y, 'Miss!', FLOAT_COLOR.miss);
      } else if (ev.type === EV.PICKUP) {
        if (ev.heal > 0) {
          spawnFloatingText(this, ev.x, ev.y, `+${ev.heal}`, FLOAT_COLOR.heal);
        } else if (ev.effect === 'strength') {
          spawnFloatingText(this, ev.x, ev.y, `+${ev.amount} STR`, FLOAT_COLOR.strength);
        } else if (ev.effect === 'skill') {
          spawnFloatingText(this, ev.x, ev.y, `+${ev.amount} SKL`, FLOAT_COLOR.skill);
        } else if (ev.effect === 'armor') {
          spawnFloatingText(this, ev.x, ev.y, `+${ev.amount} ARM`, FLOAT_COLOR.armor);
        } else if (ev.effect === 'trap') {
          spawnFloatingText(this, ev.x, ev.y, `-${ev.amount}`, FLOAT_COLOR.damage);
        }
      }
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
      // An entity's glyph never changes, so only rebind the texture if it does.
      const key = glyphKey(entityGlyph(e));
      if (img.texture.key !== key) img.setTexture(key);
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

  // Canvas/screen (CSS) pixel → tile coordinate, for click/tap input. The click
  // arrives in CSS pixels; the render buffer is device pixels, so scale by the
  // ratio before asking the camera to unproject.
  screenToTile(cssX, cssY) {
    const r = this.renderRatio || 1;
    const p = this.cameras.main.getWorldPoint(cssX * r, cssY * r);
    return worldToTile(p.x, p.y);
  }
}

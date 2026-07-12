import Phaser from 'phaser';
import { getPlayer, entitiesSorted, isVisible, isExplored } from '../core/query.js';
import { EV } from '../core/events.js';
import { GlyphGrid, createGlyphTextures } from './glyphLayer.js';
import { computeZoom, tileCenterWorld, worldToTile } from './camera.js';
import { createAsciiPainter, createPixelPainter } from './painter.js';
import { SPD_SPRITES, SPRITE_DIR } from './spriteStyle.js';
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

    // ASCII is the default and needs no external assets, so it's always ready
    // to draw the first frame. The pixel painter (and its sprite load) is
    // swapped in later by setRenderStyle when the player opts into it.
    this.asciiPainter = createAsciiPainter();
    this.pixelPainter = null; // created after its sprites finish loading
    this.pixelAssetsLoaded = false;
    this.pixelLoading = false;
    this.renderStyle = 'ascii';
    this.painter = this.asciiPainter;

    // Tiles under items under entities. Tiles get their own persistent layer
    // (created first, so it stays at the bottom) — a rebuild refills this layer
    // rather than adding tiles on top of the actors above.
    this.tileLayer = this.add.layer();
    this.grid = new GlyphGrid(this, this.painter, this.tileLayer);
    this.grid.build(this.state.map);

    this.itemLayer = this.add.layer();
    this.entityLayer = this.add.layer();
    this.itemImages = new Map();
    this.entityImages = new Map();

    this.cameras.main.setBackgroundColor('#05060a');
    this.cameras.main.setRoundPixels(true);
    this.renderRatio = 1;
    this.fitToWindow();

    // Let the composition root reach the scene to repaint and to convert
    // pointer coordinates to tiles.
    this.registry.set('scene', this);

    this.render();

    // Honor a persisted "pixel" preference: the ASCII frame is already on
    // screen, so this only kicks the sprite load and upgrades once it's ready.
    if (this.registry.get('artStyle') === 'pixel') this.setRenderStyle('pixel');

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
  rebuildFloor() {
    this.grid.destroy();
    this.grid = new GlyphGrid(this, this.painter, this.tileLayer);
    this.grid.build(this.state.map);
    for (const img of this.itemImages.values()) img.destroy();
    for (const img of this.entityImages.values()) img.destroy();
    this.itemImages.clear();
    this.entityImages.clear();
    this.render();
  }

  // Switch art styles. ASCII is instant (its textures always exist). Pixel
  // first ensures its sprites are loaded, then swaps the painter and rebuilds
  // so the two styles' differing Image geometry is recreated cleanly — the
  // painter is never swapped before its textures exist, so no frame ever draws
  // a missing (green) texture.
  setRenderStyle(style) {
    const next = style === 'pixel' ? 'pixel' : 'ascii';
    if (next === 'ascii') {
      this.renderStyle = 'ascii';
      this.painter = this.asciiPainter;
      this.rebuildFloor();
      return;
    }
    this.ensurePixelAssets(() => {
      this.renderStyle = 'pixel';
      if (!this.pixelPainter) this.pixelPainter = createPixelPainter();
      this.painter = this.pixelPainter;
      this.rebuildFloor();
    });
  }

  // Lazily load the pixel sprite set once, invoking onReady when every texture
  // is available. Loading is kicked from create()/setRenderStyle after the
  // scene is live, which is a supported Phaser mid-scene load.
  ensurePixelAssets(onReady) {
    if (this.pixelAssetsLoaded) {
      onReady();
      return;
    }
    if (this.pixelLoading) {
      this.load.once(Phaser.Loader.Events.COMPLETE, onReady);
      return;
    }
    let queued = 0;
    const base = import.meta.env.BASE_URL;
    for (const { key, file } of SPD_SPRITES) {
      if (this.textures.exists(key)) continue;
      this.load.image(key, base + SPRITE_DIR + file);
      queued++;
    }
    if (queued === 0) {
      this.pixelAssetsLoaded = true;
      onReady();
      return;
    }
    this.pixelLoading = true;
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.pixelLoading = false;
      this.pixelAssetsLoaded = true;
      onReady();
    });
    this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, (file) => {
      console.warn(`[dungeons] failed to load pixel sprite: ${file?.key} (${file?.url})`);
    });
    this.load.start();
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
        if (ev.hit) spawnFloatingText(this, ev.x, ev.y, `-${ev.damage}`, '#ff5566');
        else spawnFloatingText(this, ev.x, ev.y, 'Miss!', '#aab2c4');
      } else if (ev.type === EV.PICKUP && ev.heal > 0) {
        spawnFloatingText(this, ev.x, ev.y, `+${ev.heal}`, '#5ad07a');
      }
    }
  }

  syncItems() {
    const alive = new Set();
    for (const item of this.state.items) {
      alive.add(item.id);
      let img = this.itemImages.get(item.id);
      if (!img) {
        img = this.painter.newItemImage(this);
        this.itemLayer.add(img);
        this.itemImages.set(item.id, img);
      }
      // Remembered while explored; full color only when currently visible.
      const seen = isExplored(this.state, item.x, item.y);
      const lit = isVisible(this.state, item.x, item.y);
      img.setVisible(seen);
      this.painter.paintItem(img, item, lit);
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
        img = this.painter.newEntityImage(this);
        this.entityLayer.add(img);
        this.entityImages.set(e.id, img);
      }
      // The player is always shown; enemies only when currently in view.
      const visible = e.id === playerId || isVisible(this.state, e.x, e.y);
      this.painter.paintEntity(img, e, visible);
      img.setVisible(visible);
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

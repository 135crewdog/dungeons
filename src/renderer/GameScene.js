import Phaser from 'phaser';
import { getPlayer, entitiesSorted, isVisible, isExplored } from '../core/query.js';
import { EV } from '../core/events.js';
import { TILE_SIZE } from '../core/constants.js';
import { computeZoom, tileCenterWorld, worldToTile } from './camera.js';
import { TileLayer } from './TileLayer.js';
import { registerAtlasFrames, registerAnims } from './tileset/loader.js';
import { parseTileList } from './tileset/tileList.js';
import { ATLAS_KEY, POTION_FRAME, entityAnimKey } from './tileset/manifest.js';
import { spawnFloatingText } from './floatingText.js';

// The combined 0x72 atlas image + its frame map, bundled by Vite (the ?raw
// import keeps the atlas map in JS, so nothing extra needs precaching offline).
import atlasUrl from '../../0x72_DungeonTilesetII_v1.7/0x72_DungeonTilesetII_v1.7.png';
import tileListText from '../../0x72_DungeonTilesetII_v1.7/tile_list_v1.7?raw';

// Item/entity tints under fog. Enemies are only drawn while visible, so they
// stay full-colour; items are remembered dimly once explored.
const LIT = 0xffffff;
const DIM = 0x3a3d52;

// Depths: terrain (0) < items < entities < floating text (1000).
const ITEM_DEPTH = 5;
const ENTITY_DEPTH = 10;

// The one Phaser scene. It OBSERVES the game state and draws it — tile layer,
// items, entities — and follows the player with an integer-zoomed camera. It
// never mutates the simulation. render() is the single "state changed, repaint"
// entry point the input layer calls after each turn.
export class DungeonScene extends Phaser.Scene {
  constructor() {
    super('dungeon');
  }

  preload() {
    this.load.image(ATLAS_KEY, atlasUrl);
  }

  create() {
    this.state = this.registry.get('state');

    // Turn the loaded atlas + tile_list into named frames, then build anims.
    registerAtlasFrames(this, parseTileList(tileListText));
    registerAnims(this);

    this.tiles = new TileLayer(this);
    this.tiles.build(this.state.map);

    this.itemLayer = this.add.layer().setDepth(ITEM_DEPTH);
    this.entityLayer = this.add.layer().setDepth(ENTITY_DEPTH);
    this.itemSprites = new Map();
    this.entitySprites = new Map();

    this.cameras.main.setBackgroundColor('#05060a');
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
  rebuildFloor() {
    this.tiles.destroy();
    this.tiles = new TileLayer(this);
    this.tiles.build(this.state.map);
    for (const s of this.itemSprites.values()) s.destroy();
    for (const s of this.entitySprites.values()) s.destroy();
    this.itemSprites.clear();
    this.entitySprites.clear();
    this.render();
  }

  // Repaint everything from current state and recenter the camera.
  render() {
    this.tiles.sync(this.state);
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
      let sprite = this.itemSprites.get(item.id);
      if (!sprite) {
        sprite = this.add.image(0, 0, ATLAS_KEY, POTION_FRAME).setOrigin(0.5, 0.5);
        this.itemLayer.add(sprite);
        this.itemSprites.set(item.id, sprite);
      }
      sprite.setPosition(item.x * TILE_SIZE + TILE_SIZE / 2, item.y * TILE_SIZE + TILE_SIZE / 2);
      // Remembered while explored; full colour only when currently visible.
      const seen = isExplored(this.state, item.x, item.y);
      const lit = isVisible(this.state, item.x, item.y);
      sprite.setVisible(seen);
      sprite.setTint(lit ? LIT : DIM);
    }
    for (const [id, sprite] of this.itemSprites) {
      if (!alive.has(id)) {
        sprite.destroy();
        this.itemSprites.delete(id);
      }
    }
  }

  syncEntities() {
    const alive = new Set();
    const playerId = this.state.entities.playerId;
    for (const e of entitiesSorted(this.state)) {
      alive.add(e.id);
      let sprite = this.entitySprites.get(e.id);
      if (!sprite) {
        sprite = this.add.sprite(0, 0, ATLAS_KEY).setOrigin(0.5, 1);
        sprite.play(entityAnimKey(e.kind, 'idle'));
        this.entityLayer.add(sprite);
        this.entitySprites.set(e.id, sprite);
      }
      // Feet at the bottom-centre of the tile; tall sprites rise upward.
      sprite.setPosition(e.x * TILE_SIZE + TILE_SIZE / 2, e.y * TILE_SIZE + TILE_SIZE);
      // The player is always shown; enemies only when currently in view.
      sprite.setVisible(e.id === playerId || isVisible(this.state, e.x, e.y));
    }
    for (const [id, sprite] of this.entitySprites) {
      if (!alive.has(id)) {
        sprite.destroy();
        this.entitySprites.delete(id);
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

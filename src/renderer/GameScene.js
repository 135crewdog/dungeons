import Phaser from 'phaser';
import { getPlayer, entitiesSorted, isExplored, isRevealed } from '../core/query.js';
import { EV } from '../core/events.js';
import { GlyphGrid, createGlyphTextures, glyphKey } from './glyphLayer.js';
import { SpriteTileGrid, TILESHEET_KEY } from './spriteLayer.js';
import { computeZoom, tileToWorld, tileCenterWorld, worldToTile } from './camera.js';
import {
  entityGlyph,
  entityColor,
  itemGlyph,
  itemColor,
  scaleColor,
  FLOAT_COLOR,
  BG_COLOR,
  RENDER_STYLE,
  SPRITE_DIM,
} from './tileStyle.js';
import { spawnFloatingText } from './floatingText.js';
import { applyEventFacing } from './facing.js';
import { createMotion, TWEEN_MOVE_MS } from './motion.js';
import {
  SPRITE_SHEETS,
  ENTITY_SPRITES,
  ITEM_SPRITES,
  RING_SPRITES,
  ringFrameName,
  animKey,
  sheetKey,
  spriteOffset,
  registerSpriteFrames,
} from './entitySprites.js';

// The one Phaser scene. It OBSERVES the game state and draws it — glyph grid,
// items, entities — and follows the player with an integer-zoomed camera. It
// never mutates the simulation. render() is the single "state changed, repaint"
// entry point the input layer calls after each turn.
export class DungeonScene extends Phaser.Scene {
  constructor() {
    super('dungeon');
  }

  preload() {
    if (RENDER_STYLE !== 'sprites') return;
    // 16px frames on a 16-column sheet: frame index = col + 16*row, matching
    // the indices autotile.js emits. The relative URL resolves against
    // index.html in both dev and the `base: './'` production build.
    this.load.spritesheet(TILESHEET_KEY, 'assets/environment/tiles_prison.png', {
      frameWidth: 16,
      frameHeight: 16,
    });
    // Entity/item sheets load as plain images; their (non-16-aligned) frames
    // are carved out by registerSpriteFrames once the textures exist.
    for (const [name, url] of Object.entries(SPRITE_SHEETS)) {
      this.load.image(sheetKey(name), url);
    }
  }

  // Sprites unless disabled — or unless the sheet failed to load, in which
  // case the ASCII grid keeps the game fully playable.
  useSprites() {
    return RENDER_STYLE === 'sprites' && this.textures.exists(TILESHEET_KEY);
  }

  // Entity/item sprites need every sheet; any missing texture falls the whole
  // group back to glyphs so the cast never renders half-and-half.
  useEntitySprites() {
    return (
      RENDER_STYLE === 'sprites' &&
      Object.keys(SPRITE_SHEETS).every((name) => this.textures.exists(sheetKey(name)))
    );
  }

  makeGrid() {
    return this.useSprites() ? new SpriteTileGrid(this) : new GlyphGrid(this);
  }

  create() {
    this.state = this.registry.get('state');
    createGlyphTextures(this);
    this.entitySprites = this.useEntitySprites();
    if (this.entitySprites) registerSpriteFrames(this);

    // Persistent, explicitly depth-ordered layers: terrain under items under
    // entities under wall tops (the walls layer draws OVER actors — that
    // occlusion is the SPD pseudo-3D; it stays empty in ASCII mode). Explicit
    // depths, not add-order, so rebuildFloor can never scramble stacking.
    this.groundLayer = this.add.layer().setDepth(0);
    this.itemLayer = this.add.layer().setDepth(10);
    this.entityLayer = this.add.layer().setDepth(20);
    this.wallsLayer = this.add.layer().setDepth(30);

    this.grid = this.makeGrid();
    this.grid.build(this.state.map);

    this.itemImages = new Map();
    this.entityImages = new Map();
    // Renderer-local facing (id → 1 right | -1 left); see facing.js.
    this.facing = new Map();
    // Movement tweens / attack lunges (Phase 8); see motion.js.
    this.motion = createMotion(this);
    // Where the camera is HEADED (its settled center, in world px). Clicks
    // unproject against this, never the in-flight pan — see screenToTile.
    this.camCenter = null;
    this.camTween = null;

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
      this.centerOnPlayer(true); // resize: reframe instantly, no pan
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
      // Display size derived from the buffer, not the window: at fractional
      // dpr, floor(cssW * dpr) truncates, and displaying that buffer at the
      // un-truncated CSS width would rescale it by a non-integer hair —
      // every camera scroll then resamples on a shifted subpixel phase.
      // bufW / dpr may be a fractional CSS length; that is exact on purpose.
      canvas.style.width = bufW / dpr + 'px';
      canvas.style.height = bufH / dpr + 'px';
    }
    this.cameras.resize(bufW, bufH);
    this.cameras.main.setZoom(computeZoom(dpr));
  }

  // Discard the current floor's visuals and draw a freshly generated one.
  // The depth layers persist; only their contents are rebuilt.
  rebuildFloor() {
    this.grid.destroy();
    this.grid = this.makeGrid();
    this.grid.build(this.state.map);
    for (const img of this.itemImages.values()) img.destroy();
    for (const img of this.entityImages.values()) img.destroy();
    this.itemImages.clear();
    this.entityImages.clear();
    // Fresh floor, fresh cast: everyone re-enters facing right (default),
    // in-flight tweens die with their sprites, and the camera snaps.
    this.facing.clear();
    this.motion.clear();
    this.forceCamSnap = true;
    this.render();
  }

  // Repaint everything from current state and recenter the camera.
  render() {
    this.grid.sync(this.state);
    this.syncItems();
    this.syncEntities();
    this.centerOnPlayer();
  }

  // Recenter on the player: a short pan (matching the move-tween duration)
  // when the center merely moved a step, an instant snap on floor changes,
  // resizes, and first frame. `camCenter` always holds the SETTLED center.
  centerOnPlayer(snap = false) {
    const p = getPlayer(this.state);
    if (!p) return;
    const c = tileCenterWorld(p.x, p.y);
    const prev = this.camCenter;
    if (prev && prev.x === c.x && prev.y === c.y && !snap) return;
    if (this.forceCamSnap) {
      snap = true;
      this.forceCamSnap = false;
    }
    if (this.camTween) {
      this.camTween.remove();
      this.camTween = null;
    }
    this.camCenter = { x: c.x, y: c.y };
    if (snap || !prev) {
      this.cameras.main.centerOn(c.x, c.y);
      return;
    }
    // Pan from wherever the camera currently looks (mid-pan preemption keeps
    // the motion continuous), in lockstep with the player's move tween.
    const live = { x: this.cameras.main.midPoint.x, y: this.cameras.main.midPoint.y };
    this.camTween = this.tweens.add({
      targets: live,
      x: c.x,
      y: c.y,
      duration: TWEEN_MOVE_MS,
      ease: 'Linear',
      onUpdate: () => this.cameras.main.centerOn(live.x, live.y),
      onComplete: () => {
        this.camTween = null;
      },
    });
  }

  // Play transient effects from a turn's event list (floating numbers) and
  // turn sprites toward their movement/attack direction. Facing must apply
  // here, not on the next sync: the composition root renders durable state
  // BEFORE playing the turn's events.
  playEvents(events) {
    applyEventFacing(this.facing, events, (id) => this.state.entities.byId.get(id)?.x);
    if (this.entitySprites) {
      for (const [id, f] of this.facing) this.entityImages.get(id)?.setFlipX(f === -1);
    }
    // Slide movers from their origin tile to where render() already put
    // them; lunge attackers at their targets.
    this.motion.play(events);
    for (const ev of events) {
      if (ev.type === EV.ATTACK) {
        if (ev.hit) spawnFloatingText(this, ev.x, ev.y, `-${ev.damage}`, FLOAT_COLOR.damage);
        else spawnFloatingText(this, ev.x, ev.y, 'Miss!', FLOAT_COLOR.miss);
      } else if (ev.type === EV.PICKUP) {
        if (ev.item === 'key') {
          spawnFloatingText(this, ev.x, ev.y, '+Key', FLOAT_COLOR.key);
        } else if (ev.item === 'ring') {
          spawnFloatingText(this, ev.x, ev.y, '+Ring', FLOAT_COLOR.ring);
        } else if (ev.item === 'lockedChest') {
          spawnFloatingText(this, ev.x, ev.y, 'Unlocked!', FLOAT_COLOR.key);
        } else if (ev.heal > 0) {
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
      } else if (ev.type === EV.REVEAL) {
        spawnFloatingText(this, ev.x, ev.y, '*', FLOAT_COLOR.key);
      } else if (ev.type === EV.LOCKED) {
        spawnFloatingText(this, ev.x, ev.y, 'Locked', FLOAT_COLOR.locked);
      } else if (ev.type === EV.SURVIVAL) {
        spawnFloatingText(this, ev.x, ev.y, 'Saved!', FLOAT_COLOR.heal);
      }
    }
  }

  syncItems() {
    const alive = new Set();
    for (const item of this.state.items) {
      // Hidden secrets (unrevealed keys) don't exist visually — not even
      // dimmed, not even with the Ring of Sight; the proximity reveal is the
      // only way in.
      if (item.hidden) continue;
      alive.add(item.id);
      // Ring items carry their gem in `item.ring`; everything else keys off
      // the type. Both resolve to a named frame registered at boot.
      const spec = this.entitySprites
        ? item.type === 'ring'
          ? RING_SPRITES[item.ring]
          : ITEM_SPRITES[item.type]
        : null;
      let img = this.itemImages.get(item.id);
      if (!img) {
        const frame = item.type === 'ring' ? ringFrameName(item.ring) : item.type;
        img = spec
          ? this.add.image(0, 0, sheetKey(spec.sheet), frame).setOrigin(0, 0)
          : this.add.image(0, 0, glyphKey(itemGlyph(item))).setOrigin(0, 0);
        this.itemLayer.add(img);
        this.itemImages.set(item.id, img);
      }
      const w = tileToWorld(item.x, item.y);
      if (spec) {
        const { dx, dy } = spriteOffset(spec);
        img.setPosition(w.x + dx, w.y + dy);
      } else {
        img.setPosition(w.x, w.y);
      }
      // Remembered while explored; full color when currently visible — or
      // anywhere, with the Ring of Sight (isRevealed).
      const seen = isExplored(this.state, item.x, item.y);
      const lit = isRevealed(this.state, item.x, item.y);
      img.setVisible(seen);
      if (spec) {
        // Sprites carry their own colors: dim remembered ones uniformly.
        if (lit) img.clearTint();
        else img.setTint(SPRITE_DIM);
      } else {
        img.setTint(lit ? itemColor(item) : scaleColor(itemColor(item), 0.32));
      }
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
      const spec = this.entitySprites ? ENTITY_SPRITES[e.kind] : null;
      let img = this.entityImages.get(e.id);
      if (!img) {
        // Entities are Sprites (they animate — idle loop from creation, walk
        // while gliding via motion.js); the ASCII fallback stays on Images.
        img = spec
          ? this.add.sprite(0, 0, sheetKey(spec.sheet), e.kind).setOrigin(0, 0)
          : this.add.image(0, 0, glyphKey(entityGlyph(e))).setOrigin(0, 0);
        if (spec?.anims?.idle) img.play(animKey(e.kind, 'idle'));
        this.entityLayer.add(img);
        this.entityImages.set(e.id, img);
      }
      // A sprite mid-glide keeps its tween; the tween's destination IS this
      // tile (a new move would have preempted it in motion.play). Writing
      // the position here would teleport it to the end mid-flight.
      const tweening = this.motion.isActive(e.id);
      const w = tileToWorld(e.x, e.y);
      if (spec) {
        // Sprite art is authoritative — no tint. Centered in the tile, feet
        // just above its bottom edge (frames are sub-tile; see spriteOffset).
        const { dx, dy } = spriteOffset(spec);
        if (!tweening) img.setPosition(w.x + dx, w.y + dy);
        // Mirror in place to face the last move/attack direction (flipX
        // flips about the frame center, so position needs no adjustment).
        img.setFlipX(this.facing.get(e.id) === -1);
      } else {
        // An entity's glyph never changes, so only rebind if it does.
        const key = glyphKey(entityGlyph(e));
        if (img.texture.key !== key) img.setTexture(key);
        img.setTint(entityColor(e));
        if (!tweening) img.setPosition(w.x, w.y);
      }
      // The player is always shown; enemies when currently in view — or
      // everywhere, full color, with the Ring of Sight (isRevealed).
      img.setVisible(e.id === playerId || isRevealed(this.state, e.x, e.y));
    }
    for (const [id, img] of this.entityImages) {
      if (!alive.has(id)) {
        this.motion.stop(id); // never tween a destroyed sprite
        img.destroy();
        this.entityImages.delete(id);
      }
    }
  }

  // Canvas/screen (CSS) pixel → tile coordinate, for click/tap input. The click
  // arrives in CSS pixels; the render buffer is device pixels, so scale by the
  // ratio first. Unprojection uses the SETTLED camera center (where any
  // in-flight pan is headed), not the live camera matrix — clicks during the
  // pan resolve exactly as they will once it lands, so spam-clicking while
  // the camera glides can never mistarget.
  screenToTile(cssX, cssY) {
    const r = this.renderRatio || 1;
    const cam = this.cameras.main;
    const cx = this.camCenter ? this.camCenter.x : cam.midPoint.x;
    const cy = this.camCenter ? this.camCenter.y : cam.midPoint.y;
    const wx = cx + (cssX * r - cam.width / 2) / cam.zoom;
    const wy = cy + (cssY * r - cam.height / 2) / cam.zoom;
    return worldToTile(wx, wy);
  }
}

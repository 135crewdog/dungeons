// Atmosphere and transient effects. Everything here is a renderer-only concern:
// visual randomness goes through Phaser.Math (NEVER the seeded game RNG, which
// must stay reserved for the simulation). Effects run on Phaser's per-frame
// clock (tweens, emitters) independent of the turn-based pull loop.

import Phaser from 'phaser';
import { TILE_SIZE } from '../core/constants.js';

// Bake a radial-gradient texture once (transparent... -> ...opaque or vice
// versa), the way the ASCII build baked glyphs. Reused, tinted per effect.
function bakeRadial(scene, key, size, inner, outer) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, size, size);
  const ctx = tex.getContext();
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}

const TORCH = 'fx-torch'; // dark ring, clear centre — the torch pool
const GLOW = 'fx-glow'; // soft white blob — glows/sparks

export class Fx {
  constructor(scene) {
    this.scene = scene;
    bakeRadial(scene, TORCH, 256, 'rgba(6,7,12,0)', 'rgba(4,5,9,0.92)');
    bakeRadial(scene, GLOW, 64, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');

    // The torch pool: a darkness that closes in beyond the player's light.
    // World-space so it scales with the integer zoom; sits above the map and
    // sprites but below floating text. Followed to the player each frame.
    this.torch = scene.add
      .image(0, 0, TORCH)
      .setOrigin(0.5, 0.5)
      .setDepth(500)
      .setDisplaySize(TILE_SIZE * 26, TILE_SIZE * 26);
    this.flickerT = 0;

    // Pooled emitters for sparkles (pickup) and death motes.
    this.sparkles = scene.add
      .particles(0, 0, GLOW, {
        speed: { min: 20, max: 70 },
        lifespan: 480,
        scale: { start: 0.5, end: 0 },
        alpha: { start: 0.9, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(950);
    this.motes = scene.add
      .particles(0, 0, GLOW, {
        speed: { min: 10, max: 45 },
        lifespan: 420,
        scale: { start: 0.45, end: 0 },
        alpha: { start: 0.8, end: 0 },
        gravityY: -20,
        emitting: false,
      })
      .setDepth(950);
  }

  // Per-frame: keep the torch pool on the player and flicker its size/alpha.
  update(playerSprite, delta) {
    if (!playerSprite) return;
    this.flickerT += delta;
    const f = Math.sin(this.flickerT * 0.012) * 0.5 + Phaser.Math.FloatBetween(-0.06, 0.06);
    this.torch.setPosition(playerSprite.x, playerSprite.y - TILE_SIZE / 2);
    this.torch.setScale((TILE_SIZE * 26) / 256 * (1 + f * 0.03));
    this.torch.setAlpha(0.9 + f * 0.06);
  }

  // A soft pulsing glow that sits behind an item sprite; returns the glow so the
  // caller can destroy it with the item.
  potionGlow(itemSprite) {
    const glow = this.scene.add
      .image(itemSprite.x, itemSprite.y, GLOW)
      .setTint(0xff556b)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(itemSprite.depth - 1)
      .setScale(0.55)
      .setAlpha(0.5);
    glow.pulse = this.scene.tweens.add({
      targets: glow,
      alpha: 0.85,
      scale: 0.75,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    return glow;
  }

  // A slow shimmer sweep over the stairs sprite so the exit draws the eye.
  stairsShimmer(stairsSprite) {
    if (!stairsSprite) return;
    this.scene.tweens.add({
      targets: stairsSprite,
      alpha: { from: 1, to: 0.55 },
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // Green motes when a potion is drunk.
  pickupSparkle(tileX, tileY) {
    const x = tileX * TILE_SIZE + TILE_SIZE / 2;
    const y = tileY * TILE_SIZE + TILE_SIZE / 2;
    this.sparkles.setParticleTint(0x7ad07a);
    this.sparkles.explode(12, x, y);
  }

  // A puff of motes where something died (pixel coords).
  deathBurst(x, y, tint = 0xd8d8e0) {
    this.motes.setParticleTint(tint);
    this.motes.explode(10, x, y);
  }
}

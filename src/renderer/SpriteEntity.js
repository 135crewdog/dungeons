// A thin wrapper around one entity's Phaser sprite that owns the two things the
// pull-based turn loop can't: sub-tile motion (a tween between tiles) and facing
// (flip from travel direction). The simulation moves entities instantly in tile
// space and emits a MOVE event with {from,to}; SpriteEntity turns that into a
// short glide. Snapping to `from` before each tween makes the sim authoritative
// and self-heals any tween that didn't finish before the next step arrives.

import { TILE_SIZE } from '../core/constants.js';
import { ATLAS_KEY, entitySprite, entityAnimKey } from './tileset/manifest.js';

// Step tween must finish within the auto-walk cadence (STEP_DELAY_MS = 90ms) or
// steps would visibly stack; 90 keeps motion continuous, the pre-snap covers
// the boundary.
const STEP_MS = 90;

// Feet sit at the bottom-centre of a tile; tall hero sprites rise upward.
function tileToFeet(tx, ty) {
  return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE };
}

export class SpriteEntity {
  constructor(scene, entity) {
    this.scene = scene;
    this.kind = entity.kind;
    this.facing = 1; // 0x72 sprites face right by default
    this.moveTween = null;
    this.sprite = scene.add.sprite(0, 0, ATLAS_KEY).setOrigin(0.5, 1);
    this.sprite.play(entityAnimKey(this.kind, 'idle'));
    this.placeAt(entity.x, entity.y);
  }

  get base() {
    return entitySprite(this.kind);
  }

  stopMove() {
    if (this.moveTween) {
      this.moveTween.stop();
      this.moveTween = null;
    }
  }

  // Instant placement (initial spawn, floor rebuild, non-moving entities).
  placeAt(tx, ty) {
    this.stopMove();
    const w = tileToFeet(tx, ty);
    this.sprite.setPosition(w.x, w.y);
  }

  // Animate a one-tile step: snap to the origin tile, face the travel
  // direction, run, then glide to the destination and settle back to idle.
  moveStep(from, to) {
    this.stopMove();
    const f = tileToFeet(from.x, from.y);
    const t = tileToFeet(to.x, to.y);
    this.sprite.setPosition(f.x, f.y);
    this.faceByDelta(to.x - from.x);
    this.play('run');
    this.moveTween = this.scene.tweens.add({
      targets: this.sprite,
      x: t.x,
      y: t.y,
      duration: STEP_MS,
      ease: 'Linear',
      onComplete: () => {
        this.moveTween = null;
        this.play('idle');
      },
    });
  }

  faceByDelta(dx) {
    if (dx > 0) this.facing = 1;
    else if (dx < 0) this.facing = -1;
    this.sprite.setFlipX(this.facing < 0);
  }

  // Switch animation only when it actually changes (avoids restarting a loop).
  play(action) {
    const key = entityAnimKey(this.kind, action);
    if (this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key);
  }

  setVisible(v) {
    this.sprite.setVisible(v);
  }

  setTint(tint) {
    this.sprite.setTint(tint);
  }

  destroy() {
    this.stopMove();
    this.sprite.destroy();
  }
}

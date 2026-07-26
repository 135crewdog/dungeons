// Movement tweens and attack lunges — the Phase-8 animation layer. Two
// halves, in the facing.js mold: motionIntents() is a PURE reduction of a
// turn's event list (tested in Node with no Phaser), and createMotion() is
// the thin Phaser side that drives scene.tweens from those intents.
//
// The renderer stays observation-only: tweens are pure presentation catching
// a sprite up to where the simulation already put it. The composition root
// renders durable state BEFORE playing events, so every sprite is already
// snapped to its destination tile when play() runs — a move tween REWINDS
// the sprite to its origin tile and glides it back to where it stands.
//
// Timing contract: TWEEN_MOVE_MS < STEP_DELAY_MS (90ms), so auto-walk steps
// never overlap a glide. Held-key turns can still arrive faster (~30ms OS
// key repeat): the policy is one tween per entity, LATEST WINS — a new move
// kills the old tween (the sprite is already at the new turn's start tile,
// since consecutive moves chain) and starts fresh.

import { EV } from '../core/events.js';
import { TILE_SIZE } from '../core/constants.js';
import { ENTITY_SPRITES, animKey } from './entitySprites.js';

export const TWEEN_MOVE_MS = 80; // < STEP_DELAY_MS; also the camera pan time
export const LUNGE_PX = 4; // attack lunge reach, in world pixels
export const LUNGE_MS = 40; // each way (yoyo doubles it)

// Pure: reduce a turn's events to per-entity motion intents.
// - moves: Map<id, {from, to}> in tile coords. Consecutive MOVEs for the same
//   id chain into ONE intent from the first origin to the final destination
//   (the Ring of Speed emits two player moves per turn — one 2-tile glide).
// - lunges: one entry per attack, aimed at the target's tile; the scene
//   resolves the attacker's position (it knows the live state).
export function motionIntents(events) {
  const moves = new Map();
  const lunges = [];
  for (const ev of events) {
    if (ev.type === EV.MOVE) {
      const prev = moves.get(ev.id);
      moves.set(ev.id, { from: prev ? prev.from : ev.from, to: ev.to });
    } else if (ev.type === EV.ATTACK) {
      lunges.push({ id: ev.attackerId, x: ev.x, y: ev.y });
    }
  }
  return { moves, lunges };
}

// The Phaser half. `scene` provides entityImages (the per-id sprite pool),
// state (to resolve attacker tiles), and tweens.
export function createMotion(scene) {
  const active = new Map(); // entity id → in-flight move tween

  function isActive(id) {
    return active.has(id);
  }

  // Kill an entity's in-flight tween. The sprite keeps its current (already
  // synced) position — callers only stop tweens when the sprite is about to
  // be repositioned or destroyed anyway.
  function stop(id) {
    const tween = active.get(id);
    if (tween) {
      tween.remove();
      active.delete(id);
    }
  }

  function clear() {
    for (const tween of active.values()) tween.remove();
    active.clear();
  }

  function play(events) {
    const { moves, lunges } = motionIntents(events);

    for (const [id, m] of moves) {
      const img = scene.entityImages.get(id);
      if (!img) continue; // died/despawned this turn; the sprite is gone
      stop(id); // latest wins
      // The sprite already sits on its destination tile (render() ran
      // first). Rewind by the tile delta — this works for sprite and glyph
      // modes alike, whatever per-frame pixel offset the sprite carries.
      const endX = img.x;
      const endY = img.y;
      img.setPosition(
        endX - (m.to.x - m.from.x) * TILE_SIZE,
        endY - (m.to.y - m.from.y) * TILE_SIZE,
      );
      // Walk cycle for the glide's duration, back to idle on arrival
      // (`true` = don't restart an already-playing walk on a chained move).
      const kind = scene.state.entities.byId.get(id)?.kind;
      const anims = ENTITY_SPRITES[kind]?.anims;
      const animated = Boolean(anims && img.play);
      if (animated && anims.walk) img.play(animKey(kind, 'walk'), true);
      const tween = scene.tweens.add({
        targets: img,
        x: endX,
        y: endY,
        duration: TWEEN_MOVE_MS,
        ease: 'Linear',
        onComplete: () => {
          active.delete(id);
          if (animated && anims.idle && img.active) img.play(animKey(kind, 'idle'), true);
        },
      });
      active.set(id, tween);
    }

    for (const l of lunges) {
      const attacker = scene.state.entities.byId.get(l.id);
      const img = scene.entityImages.get(l.id);
      // Skip when the attacker's sprite is mid-move (never true today — a
      // combatant either moved or attacked — but cheap insurance).
      if (!attacker || !img || isActive(l.id)) continue;
      const ddx = Math.sign(l.x - attacker.x);
      const ddy = Math.sign(l.y - attacker.y);
      if (ddx === 0 && ddy === 0) continue;
      scene.tweens.add({
        targets: img,
        x: img.x + ddx * LUNGE_PX,
        y: img.y + ddy * LUNGE_PX,
        duration: LUNGE_MS,
        ease: 'Linear',
        yoyo: true,
      });
    }
  }

  return { play, stop, clear, isActive };
}

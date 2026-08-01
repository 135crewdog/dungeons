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
// Timing contract: TWEEN_MOVE_MS === STEP_DELAY_MS, so a glide EXACTLY FILLS
// its step. This is load-bearing, not a coincidence. When the glide was
// shorter than the step the world visibly stopped dead between steps — 80ms
// of motion then ~20ms frozen, ten times a second, which is what read as
// camera jitter. Consecutive equal-speed segments with no gap between them
// read as one continuous slide instead.
//
// The glide must never OVER-run the step either: a tween longer than the gap
// between turns can never catch up, and the lag compounds every step until
// the sprite trails the simulation by tiles. So the invariant is
// TWEEN_MOVE_MS <= STEP_DELAY_MS, and turns that arrive faster than
// STEP_DELAY_MS shorten their glide to match (see `since` in play()) —
// held-key walking fires at the OS key-repeat rate, ~30ms, far quicker than
// any auto-walk step.
//
// One tween per entity, LATEST WINS: a new move kills the old one. A glide
// preempted mid-flight is NOT rewound — it retargets from wherever the sprite
// currently is, so the motion stays continuous across the seam.

import { EV } from '../core/events.js';
import { tileToWorld } from './camera.js';
import { STEP_DELAY_MS } from '../core/constants.js';
import { ENTITY_SPRITES, animKey, playIdle, spriteOffset } from './entitySprites.js';

export const TWEEN_MOVE_MS = STEP_DELAY_MS; // a glide spans exactly one step
export const MIN_MOVE_MS = 25; // floor for turns arriving faster than that
export const LUNGE_PX = 4; // attack lunge reach, in world pixels
export const LUNGE_MS = 40; // each way (yoyo doubles it)

// How long a glide should take, given the gap since this entity's previous
// one. A full-length step gets the full glide; a burst of held-key turns gets
// glides as short as the turns themselves, so the sprite tracks the
// simulation instead of falling behind it. `since` is Infinity on a first move.
export function glideDuration(since) {
  if (!(since < TWEEN_MOVE_MS)) return TWEEN_MOVE_MS;
  return Math.max(MIN_MOVE_MS, since);
}

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

// Quantize a gliding sprite to whole WORLD pixels, every frame.
//
// This is not cosmetic rounding — it is what keeps the player from shimmering.
// Phaser's roundPixels floors the camera's scroll to a whole world pixel while
// a tween interpolates the sprite continuously, so the sprite drifts up to a
// full world pixel inside its own tile relative to the camera and snaps back:
// at zoom 6 that is a six-device-pixel sawtooth every frame, on the one sprite
// the eye is locked to. Snapping the sprite to the same grid the camera
// quantizes to makes the offset between them constant, so the player sits
// rock-still and only the world moves.
function snapToWorldPixel(img) {
  img.x = Math.round(img.x);
  img.y = Math.round(img.y);
}

// The Phaser half. `scene` provides entityImages (the per-id sprite pool),
// state (to resolve attacker tiles), and tweens.
export function createMotion(scene) {
  const active = new Map(); // entity id → in-flight move tween
  const lunging = new Map(); // entity id → in-flight attack lunge
  const lastMoveAt = new Map(); // entity id → scene clock at its last glide start

  // True while a tween owns the sprite's position. syncEntities consults this
  // before writing a position — a lunge counts, or the next turn's sync would
  // yank the sprite back mid-nudge.
  function isActive(id) {
    return active.has(id) || lunging.has(id);
  }

  // Kill an entity's in-flight tweens. The sprite keeps its current position —
  // callers only stop tweens when the sprite is about to be repositioned or
  // destroyed anyway.
  function stop(id) {
    for (const map of [active, lunging]) {
      const tween = map.get(id);
      if (tween) {
        tween.remove();
        map.delete(id);
      }
    }
  }

  function clear() {
    for (const map of [active, lunging]) {
      for (const tween of map.values()) tween.remove();
      map.clear();
    }
    lastMoveAt.clear();
  }

  // Where an entity's sprite belongs when it stands on `tile`, accounting for
  // the sub-tile frame offset in sprite mode (glyphs sit flush).
  function restingPosition(kind, tile) {
    const w = tileToWorld(tile.x, tile.y);
    const spec = scene.entitySprites ? ENTITY_SPRITES[kind] : null;
    if (!spec) return { x: w.x, y: w.y };
    const { dx, dy } = spriteOffset(spec);
    return { x: w.x + dx, y: w.y + dy };
  }

  function play(events) {
    const { moves, lunges } = motionIntents(events);

    for (const [id, m] of moves) {
      const img = scene.entityImages.get(id);
      if (!img) continue; // died/despawned this turn; the sprite is gone
      const kind = scene.state.entities.byId.get(id)?.kind;
      // Endpoints come from the TILES, never from img.x. syncEntities skips
      // the position write while a tween is in flight, so reading img.x there
      // would capture a mid-glide value as the destination and the sprite
      // would fall progressively short of its tile on every fast turn.
      const end = restingPosition(kind, m.to);

      const chained = active.has(id);
      stop(id); // latest wins
      // Starting from rest: the sprite already stands on its destination tile
      // (render() ran first), so rewind it to the origin and glide back.
      // Mid-glide: leave it exactly where it is and retarget — rewinding here
      // would jump the sprite backwards and undo the continuity.
      if (!chained) {
        const start = restingPosition(kind, m.from);
        img.setPosition(start.x, start.y);
      }

      const now = scene.time.now;
      const since = lastMoveAt.has(id) ? now - lastMoveAt.get(id) : Infinity;
      lastMoveAt.set(id, now);

      // Walk cycle for the glide's duration, back to idle on arrival
      // (`true` = don't restart an already-playing walk on a chained move,
      // so the cycle carries across a multi-tile walk).
      const anims = ENTITY_SPRITES[kind]?.anims;
      const animated = Boolean(anims && img.play);
      if (animated && anims.walk) img.play(animKey(kind, 'walk'), true);
      const tween = scene.tweens.add({
        targets: img,
        x: end.x,
        y: end.y,
        duration: glideDuration(since),
        ease: 'Linear',
        onUpdate: () => snapToWorldPixel(img),
        onComplete: () => {
          active.delete(id);
          if (animated && img.active) playIdle(img, kind, id);
        },
      });
      active.set(id, tween);
    }

    for (const l of lunges) {
      const attacker = scene.state.entities.byId.get(l.id);
      const img = scene.entityImages.get(l.id);
      // Skip when the attacker's sprite has a tween in flight. Within one turn a
      // combatant either moves or attacks, so this is not about THIS turn's
      // move — it fires when the PREVIOUS turn's glide is still running, which
      // happens whenever turns arrive faster than TWEEN_MOVE_MS (held-key
      // repeat at the ~30ms OS rate, auto-walk at the step cadence). Dropping
      // the lunge there is the right trade: retargeting a live glide to add a
      // 4px yoyo would fight the move it is in the middle of, and the swing
      // still reads through its damage number.
      if (!attacker || !img || isActive(l.id)) continue;
      const ddx = Math.sign(l.x - attacker.x);
      const ddy = Math.sign(l.y - attacker.y);
      if (ddx === 0 && ddy === 0) continue;
      const tween = scene.tweens.add({
        targets: img,
        x: img.x + ddx * LUNGE_PX,
        y: img.y + ddy * LUNGE_PX,
        duration: LUNGE_MS,
        ease: 'Linear',
        yoyo: true,
        onComplete: () => lunging.delete(l.id),
      });
      lunging.set(l.id, tween);
    }
  }

  return { play, stop, clear, isActive };
}

import { describe, it, expect } from 'vitest';
import {
  motionIntents,
  glideDuration,
  TWEEN_MOVE_MS,
  MIN_MOVE_MS,
} from '../src/renderer/motion.js';
import { idlePhase, ENTITY_SPRITES } from '../src/renderer/entitySprites.js';
import { STEP_DELAY_MS } from '../src/core/constants.js';
import { moveEvent, attackEvent, pickupEvent, deathEvent } from '../src/core/events.js';

// The pure half of the animation layer: reduce a turn's events to motion
// intents. No Phaser anywhere — same testing model as facing.js.
describe('motionIntents', () => {
  it('one move event → one glide intent', () => {
    const { moves, lunges } = motionIntents([moveEvent(1, { x: 2, y: 3 }, { x: 3, y: 3 })]);
    expect(moves.get(1)).toEqual({ from: { x: 2, y: 3 }, to: { x: 3, y: 3 } });
    expect(lunges).toHaveLength(0);
  });

  it('chains consecutive moves for the same entity into one glide (Ring of Speed)', () => {
    const { moves } = motionIntents([
      moveEvent(1, { x: 2, y: 3 }, { x: 3, y: 3 }),
      moveEvent(1, { x: 3, y: 3 }, { x: 4, y: 3 }),
    ]);
    expect(moves.size).toBe(1);
    expect(moves.get(1)).toEqual({ from: { x: 2, y: 3 }, to: { x: 4, y: 3 } });
  });

  it('keeps different entities separate', () => {
    const { moves } = motionIntents([
      moveEvent(1, { x: 1, y: 1 }, { x: 2, y: 1 }),
      moveEvent(7, { x: 5, y: 5 }, { x: 5, y: 4 }),
    ]);
    expect(moves.size).toBe(2);
    expect(moves.get(7)).toEqual({ from: { x: 5, y: 5 }, to: { x: 5, y: 4 } });
  });

  it('collects a lunge per attack, aimed at the target tile', () => {
    const { lunges } = motionIntents([
      attackEvent(1, 2, true, 5, 6, 3),
      attackEvent(4, 1, false, 0, 2, 3),
    ]);
    expect(lunges).toEqual([
      { id: 1, x: 6, y: 3 },
      { id: 4, x: 2, y: 3 },
    ]);
  });

  it('ignores non-motion events', () => {
    const { moves, lunges } = motionIntents([
      pickupEvent(9, 1, 1, { item: 'potion', heal: 8 }),
      deathEvent(2, 'goblin'),
    ]);
    expect(moves.size).toBe(0);
    expect(lunges).toHaveLength(0);
  });
});

describe('timing contract', () => {
  // A glide must FILL its step, not finish early: a glide shorter than the
  // step leaves the world frozen in the gap, which is what read as camera
  // jitter. It must not out-run the step either, or the sprite can never
  // catch up and the lag compounds every step.
  it('a move glide spans exactly one auto-walk step', () => {
    expect(TWEEN_MOVE_MS).toBe(STEP_DELAY_MS);
  });

  it('a full-length gap between turns gets the full glide', () => {
    expect(glideDuration(Infinity)).toBe(TWEEN_MOVE_MS); // first move of a walk
    expect(glideDuration(STEP_DELAY_MS)).toBe(TWEEN_MOVE_MS);
    expect(glideDuration(STEP_DELAY_MS * 3)).toBe(TWEEN_MOVE_MS);
  });

  it('turns arriving faster than a step shorten the glide to match', () => {
    // Held-key walking fires at the OS repeat rate, well under a step. The
    // glide tracks it so the sprite stays with the simulation.
    expect(glideDuration(30)).toBe(30);
    expect(glideDuration(60)).toBe(60);
  });

  it('never glides shorter than MIN_MOVE_MS, however fast turns arrive', () => {
    expect(glideDuration(0)).toBe(MIN_MOVE_MS);
    expect(glideDuration(5)).toBe(MIN_MOVE_MS);
  });
});

describe('idlePhase', () => {
  it('is deterministic and in [0, 1)', () => {
    for (const id of [1, 2, 7, 42, 1000]) {
      expect(idlePhase(id)).toBe(idlePhase(id));
      expect(idlePhase(id)).toBeGreaterThanOrEqual(0);
      expect(idlePhase(id)).toBeLessThan(1);
    }
  });

  it('spreads consecutive ids apart so neighbours do not idle in unison', () => {
    // Entity ids are allocated consecutively, so this is the case that matters:
    // a room of goblins must not all glance on the same frame.
    for (let id = 1; id < 40; id++) {
      expect(Math.abs(idlePhase(id) - idlePhase(id + 1))).toBeGreaterThan(0.3);
    }
  });
});

describe('idle cycles are SPD-calm', () => {
  // Measured off an SPD recording: their hero holds one frame for 1.5-2s at a
  // time. An even two-frame flip reads as a permanent head shake instead.
  it('humanoids hold the still frame far longer than the turned one', () => {
    for (const kind of ['player', 'goblin', 'skeleton']) {
      const { frames, fps } = ENTITY_SPRITES[kind].anims.idle;
      const still = frames.filter((f) => f === 0).length;
      expect(still).toBeGreaterThan(frames.length - still); // mostly standing
      expect((frames.length - still) / fps).toBeGreaterThanOrEqual(1); // ...but a readable glance
      expect(frames.length / fps).toBeGreaterThanOrEqual(3); // whole cycle is slow
    }
  });
});

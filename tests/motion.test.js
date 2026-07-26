import { describe, it, expect } from 'vitest';
import { motionIntents, TWEEN_MOVE_MS } from '../src/renderer/motion.js';
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
  it('the move tween always finishes inside one auto-walk step', () => {
    expect(TWEEN_MOVE_MS).toBeLessThan(STEP_DELAY_MS);
  });
});

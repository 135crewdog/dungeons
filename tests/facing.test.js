import { describe, it, expect } from 'vitest';
import { applyEventFacing } from '../src/renderer/facing.js';
import { moveEvent, attackEvent } from '../src/core/events.js';

// getX helper over a fixed position table.
const getXFrom = (positions) => (id) => positions[id];

describe('applyEventFacing', () => {
  it('faces right after moving right, left after moving left', () => {
    const facing = new Map();
    applyEventFacing(facing, [moveEvent(1, { x: 4, y: 4 }, { x: 5, y: 4 })], getXFrom({}));
    expect(facing.get(1)).toBe(1);
    applyEventFacing(facing, [moveEvent(1, { x: 5, y: 4 }, { x: 4, y: 4 })], getXFrom({}));
    expect(facing.get(1)).toBe(-1);
  });

  it('keeps the last facing on purely vertical moves', () => {
    const facing = new Map([[1, -1]]);
    applyEventFacing(facing, [moveEvent(1, { x: 4, y: 4 }, { x: 4, y: 5 })], getXFrom({}));
    expect(facing.get(1)).toBe(-1);
  });

  it('turns on diagonal moves by their horizontal component', () => {
    const facing = new Map([[1, -1]]);
    applyEventFacing(facing, [moveEvent(1, { x: 4, y: 4 }, { x: 5, y: 3 })], getXFrom({}));
    expect(facing.get(1)).toBe(1);
  });

  it('faces the attacker toward its target', () => {
    const facing = new Map([[7, 1]]);
    // Attacker id 7 at x=5 hits a target on tile (4, 4) — west of it.
    applyEventFacing(facing, [attackEvent(7, 1, true, 3, 4, 4)], getXFrom({ 7: 5 }));
    expect(facing.get(7)).toBe(-1);
  });

  it('keeps facing on straight vertical attacks', () => {
    const facing = new Map([[7, -1]]);
    applyEventFacing(facing, [attackEvent(7, 1, true, 3, 5, 3)], getXFrom({ 7: 5 }));
    expect(facing.get(7)).toBe(-1);
  });

  it('applies misses like hits — the swing still turns the attacker', () => {
    const facing = new Map();
    applyEventFacing(facing, [attackEvent(7, 1, false, 0, 6, 4)], getXFrom({ 7: 5 }));
    expect(facing.get(7)).toBe(1);
  });

  it('skips attackers that are no longer alive', () => {
    const facing = new Map();
    applyEventFacing(facing, [attackEvent(9, 1, true, 2, 4, 4)], getXFrom({}));
    expect(facing.has(9)).toBe(false);
  });

  it('leaves untouched entities absent (default right)', () => {
    const facing = new Map();
    applyEventFacing(facing, [moveEvent(1, { x: 4, y: 4 }, { x: 4, y: 5 })], getXFrom({}));
    expect(facing.has(1)).toBe(false);
  });

  it('processes a mixed turn in order (move then attack wins)', () => {
    const facing = new Map();
    applyEventFacing(
      facing,
      [
        moveEvent(1, { x: 4, y: 4 }, { x: 5, y: 4 }),
        attackEvent(1, 2, true, 4, 4, 4), // then swings west from x=5
      ],
      getXFrom({ 1: 5 }),
    );
    expect(facing.get(1)).toBe(-1);
  });
});

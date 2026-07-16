// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachKeyboard } from '../src/input/keyboard.js';
import { attachPointer } from '../src/input/pointer.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('keyboard input', () => {
  function keydown(target, code, targetEl) {
    const e = new window.KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
    if (targetEl) Object.defineProperty(e, 'target', { value: targetEl });
    target.dispatchEvent(e);
    return e;
  }

  it('maps arrows, WASD, and numpad diagonals to move commands', () => {
    const dispatch = vi.fn();
    attachKeyboard(window, dispatch);
    keydown(window, 'ArrowRight');
    keydown(window, 'KeyW');
    keydown(window, 'Numpad1');
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'move', dx: 1, dy: 0 });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'move', dx: 0, dy: -1 });
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: 'move', dx: -1, dy: 1 });
  });

  it('ignores unmapped keys', () => {
    const dispatch = vi.fn();
    attachKeyboard(window, dispatch);
    keydown(window, 'KeyQ');
    keydown(window, 'Space');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not move while typing in an input field', () => {
    const dispatch = vi.fn();
    attachKeyboard(window, dispatch);
    const input = document.createElement('input');
    document.body.appendChild(input);
    keydown(window, 'KeyD', input);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('detach removes the listener', () => {
    const dispatch = vi.fn();
    const detach = attachKeyboard(window, dispatch);
    detach();
    keydown(window, 'ArrowUp');
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('pointer input', () => {
  it('dispatches a moveTo for the tile under a primary click', () => {
    const dispatch = vi.fn();
    const toTile = vi.fn(() => ({ x: 7, y: 3 }));
    const target = document.createElement('div');
    attachPointer(target, toTile, dispatch);
    target.dispatchEvent(
      new window.MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 50 }),
    );
    expect(toTile).toHaveBeenCalledWith(100, 50);
    expect(dispatch).toHaveBeenCalledWith({ type: 'moveTo', x: 7, y: 3 });
  });

  it('ignores non-primary buttons', () => {
    const dispatch = vi.fn();
    const target = document.createElement('div');
    attachPointer(target, () => ({ x: 1, y: 1 }), dispatch);
    target.dispatchEvent(
      new window.MouseEvent('pointerdown', { button: 2, clientX: 0, clientY: 0 }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ignores off-map clicks (toTile returns null)', () => {
    const dispatch = vi.fn();
    const target = document.createElement('div');
    attachPointer(target, () => null, dispatch);
    target.dispatchEvent(
      new window.MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0 }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// Keyboard → movement commands. Uses DOM key events (no Phaser dependency).
// Cardinals come from arrow keys and WASD; the numpad (1–9) provides all eight
// directions including diagonals. Keys are matched by KeyboardEvent.code so the
// mapping is layout- and NumLock-independent.

const MOVE_BY_CODE = {
  // Cardinals: arrows
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  // Cardinals: WASD
  KeyW: { dx: 0, dy: -1 },
  KeyS: { dx: 0, dy: 1 },
  KeyA: { dx: -1, dy: 0 },
  KeyD: { dx: 1, dy: 0 },
  // Numpad: all eight directions (7 8 9 / 4 6 / 1 2 3)
  Numpad8: { dx: 0, dy: -1 },
  Numpad2: { dx: 0, dy: 1 },
  Numpad4: { dx: -1, dy: 0 },
  Numpad6: { dx: 1, dy: 0 },
  Numpad7: { dx: -1, dy: -1 },
  Numpad9: { dx: 1, dy: -1 },
  Numpad1: { dx: -1, dy: 1 },
  Numpad3: { dx: 1, dy: 1 },
};

// Attach keyboard handling. `dispatch` receives command objects. Returns a
// detach function.
export function attachKeyboard(target, dispatch) {
  function onKeyDown(e) {
    // Don't hijack keys while the user is typing in a field (e.g. the menu's
    // seed input) — WASD must reach the input, not move the player.
    if (isEditable(e.target)) return;
    const move = MOVE_BY_CODE[e.code];
    if (!move) return;
    e.preventDefault();
    dispatch({ type: 'move', dx: move.dx, dy: move.dy });
  }
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

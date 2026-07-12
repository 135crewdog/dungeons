// Game-over overlay: shown on permadeath. Offers a fresh run (new seed). A DOM
// overlay so it captures the restart click while the rest of the UI stays
// click-through. Read only; the restart callback owns the actual reset.

// `opts.isKeyboardBlocked` (optional) lets the composition root suppress the
// Enter/Space restart shortcut when another overlay is layered on top — e.g.
// the menu, opened from the death screen, where those keys belong to the seed
// form and its input, not to "New run".
export function createGameOver(parent, opts = {}) {
  const isKeyboardBlocked = opts.isKeyboardBlocked || (() => false);
  const el = document.createElement('div');
  el.id = 'gameover';
  el.className = 'overlay';
  el.innerHTML =
    '<div class="go-panel">' +
    '<h1>You died</h1>' +
    '<p class="go-sub"></p>' +
    '<button type="button">New run</button>' +
    '</div>';
  parent.appendChild(el);

  const sub = el.querySelector('.go-sub');
  const button = el.querySelector('button');
  let onRestart = null;

  button.addEventListener('click', () => {
    if (onRestart) onRestart();
  });
  // Enter or Space also restarts while the overlay is up — unless the menu is
  // layered over it, in which case those keys are the menu's (seed form/input).
  window.addEventListener('keydown', (e) => {
    if (!el.classList.contains('show')) return;
    if (isKeyboardBlocked()) return;
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      if (onRestart) onRestart();
    }
  });

  function show(state, cb) {
    onRestart = cb;
    sub.textContent = `You reached floor ${state.floor}.`;
    el.classList.add('show');
  }

  function hide() {
    el.classList.remove('show');
  }

  return { show, hide, el };
}

// Game-over overlay: shown on permadeath. Offers a fresh run (new seed). A DOM
// overlay so it captures the restart click while the rest of the UI stays
// click-through. Read only; the restart callback owns the actual reset.

export function createGameOver(parent) {
  const el = document.createElement('div');
  el.id = 'gameover';
  el.className = 'overlay';
  el.innerHTML =
    '<div class="go-panel">' +
    '<h1>You died</h1>' +
    '<p class="go-sub"></p>' +
    '<button type="button">New run</button>' +
    '<p class="go-hint">Press <b>Esc</b> or <b>Menu</b> for the seed &amp; retry.</p>' +
    '</div>';
  parent.appendChild(el);

  const sub = el.querySelector('.go-sub');
  const button = el.querySelector('button');
  let onRestart = null;

  button.addEventListener('click', () => {
    if (onRestart) onRestart();
  });
  // Enter or Space also restarts while the overlay is up.
  window.addEventListener('keydown', (e) => {
    if (!el.classList.contains('show')) return;
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

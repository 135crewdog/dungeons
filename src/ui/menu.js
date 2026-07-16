// Pause/options menu overlay. Opened by the on-screen "Menu" text button or
// the Escape key; closed by Escape, the Resume button, or clicking the
// backdrop.
// A DOM overlay like the HUD and game-over screen — it only reads the seed and
// invokes lifecycle callbacks (new run / restart / load seed) supplied by the
// composition root. It never touches the simulation state or the renderer.
//
// While the menu is open the composition root gates player input, so the game
// is effectively paused. The menu deliberately stays small; a future ASCII↔
// sprite toggle would slot into the actions list without restructuring it.

import { writeClipboard } from './clipboard.js';
import { APP_VERSION } from './version.js';
import { createOverlay } from './overlay.js';

// `actions` wires the menu to the composition root:
//   getSeed()        → the current run's seed (for display / copy)
//   canOpen()        → whether opening is allowed (only while playing)
//   onOpen()         → side effects when opening (e.g. cancel auto-walk)
//   onNewRun()       → start a fresh run with a new random seed
//   onRestartSeed()  → replay the current run from floor 1 (same seed)
//   onLoadSeed(text) → start a run from a user-entered seed
//   onLeaderboard()  → open the leaderboard overlay (menu stays open below)
//   onHelp()         → open the help overlay (menu stays open below)
//   isChildOpen()    → a child overlay (leaderboard/help) is layered on top,
//                      so Escape belongs to it, not to this menu
export function createMenu(parent, actions) {
  // The trigger is plain HUD text ("Menu"), anchored top-right — same visual
  // language as the HP/Floor readouts, not a boxed icon.
  const button = document.createElement('button');
  button.id = 'menubtn';
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'dialog');
  button.textContent = 'Menu';
  parent.appendChild(button);

  const { el, panel, isOpen, show, hide } = createOverlay({
    id: 'menu',
    title: 'Menu',
    ariaLabel: 'Menu',
    onClose: () => close(),
  });
  panel.insertAdjacentHTML(
    'beforeend',
    '<div class="menu-actions">' +
      '<button type="button" data-act="resume">Resume</button>' +
      '<button type="button" data-act="newrun">New run</button>' +
      '<button type="button" data-act="restart">Restart this seed</button>' +
      '<button type="button" data-act="board">Leaderboard</button>' +
      '<button type="button" data-act="help">Help</button>' +
      '</div>' +
      '<div class="menu-seed">' +
      '<div class="menu-seed-label">Seed</div>' +
      '<div class="menu-seed-row"><code class="menu-seed-val"></code>' +
      '<button type="button" data-act="copy">Copy</button></div>' +
      '<form class="menu-seed-row" data-act="loadform">' +
      '<input class="menu-seed-input" type="text" inputmode="text" autocomplete="off" ' +
      'spellcheck="false" placeholder="Enter seed" aria-label="Enter seed" />' +
      '<button type="submit" data-act="load">Play</button></form>' +
      '</div>' +
      '<div class="menu-version">Dungeons v' +
      APP_VERSION +
      '</div>',
  );
  parent.appendChild(el);

  const seedVal = el.querySelector('.menu-seed-val');
  const seedInput = el.querySelector('.menu-seed-input');
  const copyBtn = el.querySelector('[data-act="copy"]');
  const loadForm = el.querySelector('[data-act="loadform"]');
  let copyFlash = null;

  function open() {
    if (isOpen() || !actions.canOpen()) return;
    actions.onOpen?.();
    seedVal.textContent = String(actions.getSeed());
    seedInput.value = '';
    resetCopy();
    show(); // adds .show and focuses the panel
    button.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (!isOpen()) return;
    hide();
    button.setAttribute('aria-expanded', 'false');
    button.focus();
  }

  function toggle() {
    isOpen() ? close() : open();
  }

  function resetCopy() {
    if (copyFlash) {
      clearTimeout(copyFlash);
      copyFlash = null;
    }
    copyBtn.textContent = 'Copy';
  }

  async function copySeed() {
    const ok = await writeClipboard(String(actions.getSeed()));
    copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed';
    if (copyFlash) clearTimeout(copyFlash);
    copyFlash = setTimeout(resetCopy, 1200);
  }

  function loadSeed() {
    const text = seedInput.value.trim();
    if (text === '') {
      seedInput.focus();
      return;
    }
    close();
    actions.onLoadSeed(text);
  }

  // One click handler for the menu's action buttons, dispatched by data-act.
  // The × and backdrop-click close are owned by the overlay factory (onClose).
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    switch (act) {
      case 'resume':
        close();
        break;
      case 'newrun':
        close();
        actions.onNewRun();
        break;
      case 'restart':
        close();
        actions.onRestartSeed();
        break;
      case 'copy':
        copySeed();
        break;
      // Leaderboard/help layer over the menu, which stays open underneath so
      // Escape (or closing the child) drops straight back into it.
      case 'board':
        actions.onLeaderboard();
        break;
      case 'help':
        actions.onHelp();
        break;
      // 'load' is a submit button handled by the form's submit event.
    }
  });

  loadForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loadSeed();
  });

  button.addEventListener('click', toggle);

  // Escape toggles the menu globally: closes it if open, else opens it (when
  // allowed). Handled here rather than in the movement keyboard layer, which is
  // concerned only with turning key presses into moves.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // A child overlay (leaderboard/help) is on top: Escape is its to handle.
    // Children register their handlers after this one, so deferring here is
    // enough — the same keypress then closes only the topmost layer.
    if (actions.isChildOpen?.()) return;
    if (!isOpen() && !actions.canOpen()) return;
    e.preventDefault();
    toggle();
  });

  // Keep the displayed seed current if the menu happens to be open across a
  // seed change (e.g. after a load). Cheap and idempotent.
  function refresh() {
    if (isOpen()) seedVal.textContent = String(actions.getSeed());
  }

  return { isOpen, open, close, toggle, refresh, el, button };
}

// Shared scaffolding for the modal overlays (menu, leaderboard, help). Builds
// the common shell — a full-screen `.overlay` backdrop wrapping a
// `.menu-panel` dialog with a titled head and a × close button — and the
// show/hide/isOpen plumbing plus backdrop-and-× click-to-close. While open,
// Tab is trapped inside the panel (the aria-modal contract) and on hide focus
// returns to whatever had it before the overlay opened. Each overlay fills
// the panel with its own content and owns its own Escape policy (the menu
// defers to child overlays; the children close only themselves), so beyond
// the Tab trap the factory deliberately does not touch the keyboard.

import { trapTabKey } from './dom.js';

// options:
//   id         → the overlay element's id (#menu, #leaderboard, #help)
//   title      → the head's <h2> text
//   ariaLabel  → the dialog's aria-label
//   panelClass → extra class on the panel (e.g. 'lb-panel', 'help-panel')
//   onClose    → called when the × or the backdrop is clicked
// Returns { el, panel, isOpen, show, hide } — `panel` is where callers append
// their content (it already contains the head).
export function createOverlay({ id, title, ariaLabel, panelClass = '', onClose }) {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'overlay';

  const panel = document.createElement('div');
  panel.className = ['menu-panel', panelClass].filter(Boolean).join(' ');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', ariaLabel);
  panel.tabIndex = -1;

  const head = document.createElement('div');
  head.className = 'menu-head';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'menu-x';
  closeBtn.type = 'button';
  closeBtn.dataset.act = 'close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  head.append(h2, closeBtn);
  panel.appendChild(head);
  el.appendChild(panel);

  let restoreTo = null; // what had focus before the overlay opened

  function isOpen() {
    return el.classList.contains('show');
  }
  function show() {
    restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el.classList.add('show');
    panel.focus();
  }
  function hide() {
    el.classList.remove('show');
    // Return focus to the opener (e.g. the menu's Leaderboard/Help button) so
    // keyboard users don't get dropped at the top of the document.
    if (restoreTo && document.contains(restoreTo)) restoreTo.focus();
    restoreTo = null;
  }

  if (onClose) {
    el.addEventListener('click', (e) => {
      // The × button or a click on the dimmed backdrop (outside the panel).
      if (e.target === el || e.target.closest('[data-act="close"]')) onClose();
    });
  }

  // Focus trap: while open, Tab cycles within the dialog. Scoped to the
  // overlay element — keydown only bubbles here while focus is inside it,
  // which is exactly when the trap should act (a child overlay layered above
  // holds its own focus, so the one below never sees the key).
  el.addEventListener('keydown', (e) => {
    if (isOpen()) trapTabKey(panel, e);
  });

  return { el, panel, isOpen, show, hide };
}

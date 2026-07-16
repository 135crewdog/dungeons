// Shared scaffolding for the modal overlays (menu, leaderboard, help). Builds
// the common shell — a full-screen `.overlay` backdrop wrapping a
// `.menu-panel` dialog with a titled head and a × close button — and the
// show/hide/isOpen plumbing plus backdrop-and-× click-to-close. Each overlay
// fills the panel with its own content and owns its own Escape policy (the
// menu defers to child overlays; the children close only themselves), so the
// factory deliberately does not touch the keyboard.

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

  function isOpen() {
    return el.classList.contains('show');
  }
  function show() {
    el.classList.add('show');
    panel.focus();
  }
  function hide() {
    el.classList.remove('show');
  }

  if (onClose) {
    el.addEventListener('click', (e) => {
      // The × button or a click on the dimmed backdrop (outside the panel).
      if (e.target === el || e.target.closest('[data-act="close"]')) onClose();
    });
  }

  return { el, panel, isOpen, show, hide };
}

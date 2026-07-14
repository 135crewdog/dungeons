// Game-over overlay: shown on permadeath. Offers arcade-style initials entry
// for the leaderboard (one submission per death), a leaderboard view, and a
// fresh run (new seed). A DOM overlay so it captures clicks while the rest of
// the UI stays click-through. Read only; the callbacks own the actual work.

import { sanitizeInitials, isValidInitials } from '../net/leaderboard.js';

// Options wire the overlay to the composition root:
//   isKeyboardBlocked()      → suppress the Enter/Space restart shortcut while
//                              another overlay is layered on top (menu,
//                              leaderboard, help)
//   canSubmit()              → whether score submission is available at all
//                              (false while LEADERBOARD_URL is unconfigured)
//   getLastInitials()        → prefill for the initials input
//   onSubmitScore(initials)  → async; resolves { ok, queued }
//   onShowLeaderboard()      → open the leaderboard overlay
export function createGameOver(parent, opts = {}) {
  const isKeyboardBlocked = opts.isKeyboardBlocked || (() => false);
  const canSubmit = opts.canSubmit || (() => false);
  const getLastInitials = opts.getLastInitials || (() => '');

  const el = document.createElement('div');
  el.id = 'gameover';
  el.className = 'overlay';
  el.innerHTML =
    '<div class="go-panel">' +
    '<h1>You died</h1>' +
    '<p class="go-sub"></p>' +
    '<form class="go-initials">' +
    '<input class="go-initials-input" type="text" maxlength="3" placeholder="AAA" ' +
    'autocomplete="off" autocapitalize="characters" spellcheck="false" ' +
    'aria-label="Your initials for the leaderboard" />' +
    '<button type="submit">Submit</button>' +
    '</form>' +
    '<p class="go-status"></p>' +
    '<div class="go-buttons">' +
    '<button type="button" data-act="board">Leaderboard</button>' +
    '<button type="button" data-act="restart">New run</button>' +
    '</div>' +
    '</div>';
  parent.appendChild(el);

  const sub = el.querySelector('.go-sub');
  const form = el.querySelector('.go-initials');
  const input = el.querySelector('.go-initials-input');
  const submitBtn = form.querySelector('button');
  const status = el.querySelector('.go-status');
  let onRestart = null;

  // Keep the field arcade-clean while typing: uppercase, A-Z0-9, max 3.
  input.addEventListener('input', () => {
    input.value = sanitizeInitials(input.value);
  });

  // One submission per death: the form locks itself after a submit attempt
  // and only show() (a fresh death) unlocks it.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const initials = sanitizeInitials(input.value);
    if (!isValidInitials(initials)) {
      input.focus();
      return;
    }
    input.disabled = true;
    submitBtn.disabled = true;
    status.textContent = 'Sending…';
    const res = await opts.onSubmitScore(initials);
    status.textContent = res.ok
      ? 'Submitted!'
      : res.queued
        ? 'Saved offline — will send later.'
        : 'Couldn’t submit.';
  });

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'restart' && onRestart) onRestart();
    else if (act === 'board') opts.onShowLeaderboard?.();
  });

  // Enter or Space also restarts while the overlay is up — unless another
  // overlay is layered over it, or the initials input has focus (there Enter
  // belongs to the form).
  window.addEventListener('keydown', (e) => {
    if (!el.classList.contains('show')) return;
    if (isKeyboardBlocked()) return;
    if (isEditable(e.target)) return;
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      if (onRestart) onRestart();
    }
  });

  function show(state, cb) {
    // The per-turn callback can fire while already dead (e.g. after a menu
    // close); don't reset the initials form once it's on screen.
    if (el.classList.contains('show')) return;
    onRestart = cb;
    sub.textContent = `You reached floor ${state.floor}.`;
    form.style.display = canSubmit() ? '' : 'none';
    input.disabled = false;
    submitBtn.disabled = false;
    input.value = getLastInitials();
    status.textContent = '';
    el.classList.add('show');
  }

  function hide() {
    el.classList.remove('show');
  }

  return { show, hide, el };
}

function isEditable(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

// Leaderboard overlay: the top runs of the last 30 days, fetched from the
// worker via the composition root's fetchScores callback. A DOM overlay like
// the menu, but layered above it (z-index 30) so it can be opened *from* the
// menu; Escape closes this layer only (the menu defers via isChildOpen).
//
// Rows come from the network — other players' input — so every cell is
// rendered with textContent, never markup interpolation.

import { formatAge } from '../net/leaderboard.js';

export function createLeaderboard(parent, { fetchScores }) {
  const el = document.createElement('div');
  el.id = 'leaderboard';
  el.className = 'overlay';
  el.innerHTML =
    '<div class="menu-panel lb-panel" role="dialog" aria-modal="true" aria-label="Leaderboard" tabindex="-1">' +
    '<div class="menu-head"><h2>Leaderboard</h2>' +
    '<button class="menu-x" type="button" data-act="close" aria-label="Close">×</button></div>' +
    '<div class="panel-label">Top runs — last 30 days</div>' +
    '<div class="lb-body"></div>' +
    '</div>';
  parent.appendChild(el);

  const panel = el.querySelector('.menu-panel');
  const body = el.querySelector('.lb-body');
  // Guards a stale fetch resolving after the overlay was closed and reopened.
  let requestToken = 0;

  function isOpen() {
    return el.classList.contains('show');
  }

  function renderStatus(text) {
    body.textContent = '';
    const status = document.createElement('div');
    status.className = 'lb-status';
    status.textContent = text;
    body.appendChild(status);
  }

  function cell(tag, text, className) {
    const td = document.createElement(tag);
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  function renderScores(scores, serverNow) {
    if (scores.length === 0) {
      renderStatus('No scores yet — be the first.');
      return;
    }
    body.textContent = '';
    const table = document.createElement('table');
    table.className = 'lb-table';
    const head = document.createElement('tr');
    head.append(
      cell('th', '#'),
      cell('th', 'Who'),
      cell('th', 'Floor', 'lb-num'),
      cell('th', 'Ver'),
      cell('th', 'When', 'lb-num'),
    );
    table.appendChild(head);
    scores.forEach((row, i) => {
      const tr = document.createElement('tr');
      tr.append(
        cell('td', String(i + 1), 'lb-dim'),
        cell('td', String(row.initials), 'lb-initials'),
        cell('td', String(row.floor), 'lb-num'),
        cell('td', String(row.version), 'lb-dim'),
        cell('td', formatAge(row.created_at, serverNow), 'lb-num lb-dim'),
      );
      table.appendChild(tr);
    });
    body.appendChild(table);
  }

  async function open() {
    el.classList.add('show');
    panel.focus();
    const token = ++requestToken;
    renderStatus('Loading…');
    const res = await fetchScores();
    if (token !== requestToken || !isOpen()) return;
    if (res.ok) renderScores(res.scores, res.now);
    else if (res.disabled) renderStatus('Leaderboard not configured.');
    else if (navigator.onLine === false) renderStatus("You're offline.");
    else renderStatus("Couldn't reach the leaderboard.");
  }

  function close() {
    if (!isOpen()) return;
    requestToken += 1;
    el.classList.remove('show');
  }

  el.addEventListener('click', (e) => {
    // The × button or a click on the dimmed backdrop closes.
    if (e.target === el || e.target.closest('[data-act="close"]')) close();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.preventDefault();
    close();
  });

  return { open, close, isOpen, el };
}

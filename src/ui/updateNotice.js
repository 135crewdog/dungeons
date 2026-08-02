// A dim one-line notice that a newer build is installed and waiting, parked
// under the version watermark in the top-right stack.
//
// The PWA registers with registerType: 'prompt' on purpose (vite.config.js): a
// new service worker waits rather than seizing the page, because a background
// reload in a permadeath game destroys a run — and ?seed= only replays it from
// floor 1. Something therefore has to tell the player a build is ready, and
// this is deliberately the quietest thing that can: watermark-dim, no panel, no
// backdrop, no pause, no timeout. A line of text that can be ignored for a week.
//
// Like every other overlay here it builds its DOM with createElement +
// textContent only, and it knows nothing about service workers — the
// composition root injects `onApply`.

// options:
//   onApply() → apply the waiting update (main.js posts SKIP_WAITING; the
//               reload happens when the new worker takes control, not here)
export function createUpdateNotice(parent, { onApply = null } = {}) {
  // A live region that exists from boot and stays EMPTY until there is
  // something to say, so raising the line is an insertion assistive tech
  // announces. Toggling `hidden` on the region itself would not be: a live
  // region has to be in the accessibility tree before the change it reports.
  // `polite` waits for a pause in speech — this is a notice to act on whenever
  // the player likes, and interrupting a fight to read it would be exactly the
  // intrusion the design is avoiding.
  const el = document.createElement('div');
  el.id = 'updatenotice';
  el.setAttribute('aria-live', 'polite');
  parent.appendChild(el);

  // A real <button>, not a styled <div> with a click handler: focusability,
  // Enter/Space activation and the button role all come from the platform, so
  // there is no keydown handler here to double-fire against them.
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'update-line';
  button.textContent = 'Update ready — reload';
  button.title = 'A newer version is installed — reload to use it';

  button.addEventListener('click', () => {
    if (button.disabled) return;
    // Applying is not instantaneous: it messages the waiting worker, and the
    // page reloads when that worker takes control. Say so, and make a second
    // click a no-op rather than a second SKIP_WAITING.
    button.disabled = true;
    button.textContent = 'Updating…';
    onApply?.();
  });

  // Membership of the live region IS the shown/hidden state, so there is never
  // a hidden-but-present line for a screen reader or the Tab order to find.
  function isShown() {
    return el.contains(button);
  }

  function show() {
    if (isShown()) return; // a repeat `waiting` event must not re-announce
    el.appendChild(button);
  }

  function hide() {
    button.remove();
  }

  return { el, button, show, hide, isShown };
}

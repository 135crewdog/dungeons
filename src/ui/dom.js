// Small shared DOM helpers for the overlay/input layers.

// True when the element is a text-entry field, so key handlers can stand down
// and let the user type (e.g. WASD in the seed input must not move the player,
// and Enter in the initials field submits rather than restarting).
export function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Hidden-by-inline-style check that works without layout (jsdom has no
// offsetParent): an element counts as shown unless it or an ancestor is
// display:none — which is how the overlays hide things (e.g. the game-over
// initials form when submission is disabled).
function isShown(el) {
  for (let node = el; node; node = node.parentElement) {
    if (node.style && node.style.display === 'none') return false;
  }
  return true;
}

// Keep Tab/Shift+Tab cycling inside an open dialog panel (a focus trap, the
// aria-modal contract). Call from a keydown listener; non-Tab keys pass
// through. If focus somehow left the panel, the next Tab pulls it back in.
export function trapTabKey(panel, e) {
  if (e.key !== 'Tab') return;
  const items = [...panel.querySelectorAll(FOCUSABLE)].filter(isShown);
  if (items.length === 0) {
    e.preventDefault();
    panel.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !panel.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else if (active === last || !panel.contains(active)) {
    e.preventDefault();
    first.focus();
  }
}

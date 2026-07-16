// Small shared DOM helpers for the overlay/input layers.

// True when the element is a text-entry field, so key handlers can stand down
// and let the user type (e.g. WASD in the seed input must not move the player,
// and Enter in the initials field submits rather than restarting).
export function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

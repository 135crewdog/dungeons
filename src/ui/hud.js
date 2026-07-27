// HUD overlay: current HP and floor number anchored to the top-left corner,
// plus the app version tucked top-right under the Menu text (reference info,
// kept apart from the realtime gameplay stats). A DOM overlay (not Phaser) so
// it stays crisp at native resolution and reflows with the aspect ratio
// independent of the integer-zoomed map. It only reads state; it never
// mutates it.
//
// Every readout is built from DOM nodes — createElement + textContent + style
// properties, swapped in with replaceChildren. Nothing here interpolates state
// into an HTML string: the values are internal today, but a HUD that renders
// markup is one feature (mods, saves, custom names) away from being an XSS
// sink, and the node form costs nothing.

import { getPlayer } from '../core/query.js';
import { RING_TYPES, RING_FLAG } from '../core/constants.js';
import { APP_VERSION } from './version.js';

// `iconFor(kind)` is injected by the composition root (it alone may bridge
// renderer sprite data into the DOM overlays): it returns a fresh <span>
// element cropping the sprite sheet, or null — the chips degrade to text-only
// when it is absent (tests, sheet failed to load). Same seam the Help legend
// uses.
export function createHud(parent, { iconFor = null } = {}) {
  const el = document.createElement('div');
  el.id = 'hud';
  el.className = 'overlay';
  parent.appendChild(el);

  // Static, so it lives outside the per-turn rebuild.
  const version = document.createElement('div');
  version.id = 'hudversion';
  version.className = 'overlay';
  version.textContent = `v${APP_VERSION}`;
  parent.appendChild(version);

  // One readout: [icon] Label <b>value</b>. `label` may be empty (ring chips
  // are icon + name only); `color` styles the value when given.
  function chip(iconKind, label, value, color) {
    const span = document.createElement('span');
    span.className = 'hud-item';
    const icon = iconKind && iconFor ? iconFor(iconKind) : null;
    if (icon) span.appendChild(icon);
    if (label) span.appendChild(document.createTextNode(`${label} `));
    const b = document.createElement('b');
    b.textContent = value;
    if (color) b.style.color = color;
    span.appendChild(b);
    return span;
  }

  function update(state) {
    const p = getPlayer(state);
    if (!p) return;
    const ratio = p.hp / p.maxHp;
    // CSS custom properties from index.html's :root — the single source for
    // every DOM-UI color (var() resolves inside inline styles too).
    const color = ratio > 0.5 ? 'var(--c-good)' : ratio > 0.25 ? 'var(--c-warn)' : 'var(--c-bad)';

    const hp = chip(null, 'HP', String(p.hp), color);
    const max = document.createElement('span');
    max.className = 'hud-dim';
    max.textContent = `/${p.maxHp}`;
    hp.appendChild(max);

    const items = [hp, chip(null, 'Floor', String(state.floor))];
    // Chest-earned stats appear once the first bonus is banked.
    if (p.strength > 0) items.push(chip(null, 'STR', `+${p.strength}`));
    if (p.skill > 0) items.push(chip(null, 'SKL', `+${p.skill}`));
    if (p.armor > 0) items.push(chip(null, 'ARM', `+${p.armor}`));
    // The key chip counts the secret keys in hand; ring chips appear as rings
    // are worn (gem icon + short name).
    if ((p.keys ?? 0) > 0) items.push(chip('key', 'KEY', `×${p.keys}`));
    for (const r of RING_TYPES) {
      if (p[RING_FLAG[r]] ?? false) {
        items.push(chip(`ring:${r}`, '', r[0].toUpperCase() + r.slice(1)));
      }
    }
    el.replaceChildren(...items);
  }

  return { update, el };
}

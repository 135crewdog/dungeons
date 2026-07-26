// HUD overlay: current HP and floor number anchored to the top-left corner,
// plus the app version tucked top-right under the Menu text (reference info,
// kept apart from the realtime gameplay stats). A DOM overlay (not Phaser) so
// it stays crisp at native resolution and reflows with the aspect ratio
// independent of the integer-zoomed map. It only reads state; it never
// mutates it.

import { getPlayer } from '../core/query.js';
import { RING_TYPES, RING_FLAG } from '../core/constants.js';
import { APP_VERSION } from './version.js';

// `iconHtml(kind)` is injected by the composition root (it alone may bridge
// renderer sprite data into the DOM overlays): it returns an inline-styled
// <span> HTML string cropping the sprite sheet, or '' — the chips degrade to
// text-only when it is absent (tests, sheet failed to load).
export function createHud(parent, { iconHtml = () => '' } = {}) {
  const el = document.createElement('div');
  el.id = 'hud';
  el.className = 'overlay';
  parent.appendChild(el);

  // Static, so it lives outside the per-turn innerHTML rewrite.
  const version = document.createElement('div');
  version.id = 'hudversion';
  version.className = 'overlay';
  version.textContent = `v${APP_VERSION}`;
  parent.appendChild(version);

  function update(state) {
    const p = getPlayer(state);
    if (!p) return;
    const ratio = p.hp / p.maxHp;
    // CSS custom properties from index.html's :root — the single source for
    // every DOM-UI color (var() resolves inside inline styles too).
    const color = ratio > 0.5 ? 'var(--c-good)' : ratio > 0.25 ? 'var(--c-warn)' : 'var(--c-bad)';
    // Ring chips appear as rings are worn (short name + gem icon); the key
    // chip counts the secret keys in hand.
    const rings = RING_TYPES.filter((r) => p[RING_FLAG[r]] ?? false)
      .map(
        (r) =>
          `<span class="hud-item">${iconHtml(`ring:${r}`)}<b>${r[0].toUpperCase() + r.slice(1)}</b></span>`,
      )
      .join('');
    el.innerHTML =
      `<span class="hud-item">HP <b style="color:${color}">${p.hp}</b>` +
      `<span class="hud-dim">/${p.maxHp}</span></span>` +
      `<span class="hud-item">Floor <b>${state.floor}</b></span>` +
      // Chest-earned stats appear once the first bonus is banked.
      (p.strength > 0 ? `<span class="hud-item">STR <b>+${p.strength}</b></span>` : '') +
      (p.skill > 0 ? `<span class="hud-item">SKL <b>+${p.skill}</b></span>` : '') +
      (p.armor > 0 ? `<span class="hud-item">ARM <b>+${p.armor}</b></span>` : '') +
      ((p.keys ?? 0) > 0
        ? `<span class="hud-item">${iconHtml('key')}KEY <b>×${p.keys}</b></span>`
        : '') +
      rings;
  }

  return { update, el };
}

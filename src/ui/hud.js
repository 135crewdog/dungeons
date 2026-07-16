// HUD overlay: current HP and floor number anchored to the top-left corner,
// plus the app version tucked top-right under the Menu text (reference info,
// kept apart from the realtime gameplay stats). A DOM overlay (not Phaser) so
// it stays crisp at native resolution and reflows with the aspect ratio
// independent of the integer-zoomed map. It only reads state; it never
// mutates it.

import { getPlayer } from '../core/query.js';
import { APP_VERSION } from './version.js';

export function createHud(parent) {
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
    el.innerHTML =
      `<span class="hud-item">HP <b style="color:${color}">${p.hp}</b>` +
      `<span class="hud-dim">/${p.maxHp}</span></span>` +
      `<span class="hud-item">Floor <b>${state.floor}</b></span>` +
      // Chest-earned stats appear once the first bonus is banked.
      (p.strength > 0 ? `<span class="hud-item">STR <b>+${p.strength}</b></span>` : '') +
      (p.skill > 0 ? `<span class="hud-item">SKL <b>+${p.skill}</b></span>` : '') +
      (p.armor > 0 ? `<span class="hud-item">ARM <b>+${p.armor}</b></span>` : '');
  }

  return { update, el };
}

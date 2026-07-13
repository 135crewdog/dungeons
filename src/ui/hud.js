// HUD overlay: current HP, floor number, and app version, anchored to the
// top-left corner. A DOM overlay (not Phaser) so it stays crisp at native
// resolution and reflows with the aspect ratio independent of the
// integer-zoomed map. It only reads state; it never mutates it.

import { getPlayer } from '../core/query.js';
import { APP_VERSION } from './version.js';

export function createHud(parent) {
  const el = document.createElement('div');
  el.id = 'hud';
  el.className = 'overlay';
  parent.appendChild(el);

  function update(state) {
    const p = getPlayer(state);
    if (!p) return;
    const ratio = p.hp / p.maxHp;
    const color = ratio > 0.5 ? '#7ad07a' : ratio > 0.25 ? '#e8c15a' : '#ff6b6b';
    el.innerHTML =
      `<span class="hud-item">HP <b style="color:${color}">${p.hp}</b>` +
      `<span class="hud-dim">/${p.maxHp}</span></span>` +
      `<span class="hud-item">Floor <b>${state.floor}</b></span>` +
      // Chest-earned stats appear once the first bonus is banked.
      (p.strength > 0 ? `<span class="hud-item">STR <b>+${p.strength}</b></span>` : '') +
      (p.skill > 0 ? `<span class="hud-item">SKL <b>+${p.skill}</b></span>` : '') +
      (p.armor > 0 ? `<span class="hud-item">ARM <b>+${p.armor}</b></span>` : '') +
      // Build version, dim so it reads as a watermark — lets screenshots be
      // matched to a release.
      `<span class="hud-item hud-dim">v${APP_VERSION}</span>`;
  }

  return { update, el };
}

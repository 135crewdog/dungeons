// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createHelp } from '../src/ui/help.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('help legend (sprite-first)', () => {
  it('renders sprite icons through the injected factory', () => {
    const asked = [];
    const iconFor = (kind) => {
      asked.push(kind);
      const s = document.createElement('span');
      s.className = 'ui-icon';
      s.dataset.kind = kind;
      return s;
    };
    const { el } = createHelp(document.body, { iconFor });
    // Every cast member, loot type, ring, and terrain row asked for its icon.
    for (const kind of [
      'player',
      'goblin',
      'skeleton',
      'boss',
      'potion',
      'chest',
      'lockedChest',
      'key',
      'ring:sight',
      'ring:shadow',
      'ring:speed',
      'ring:survival',
      'stairsDown',
      'stairsUp',
      'door',
      'wall',
      'floor',
    ]) {
      expect(asked, `no icon requested for ${kind}`).toContain(kind);
      expect(el.querySelector(`[data-kind="${kind}"]`), `no icon in DOM for ${kind}`).toBeTruthy();
    }
  });

  it('describes the secrets in the legend text', () => {
    const { el } = createHelp(document.body, { iconFor: () => null });
    expect(el.textContent).toContain('Locked chest');
    expect(el.textContent).toContain('Ring of Shadow');
    expect(el.textContent).toContain('Ring of Survival');
    expect(el.textContent).toContain('glints');
  });

  it('falls back to name-only rows without an icon factory', () => {
    const { el } = createHelp(document.body);
    expect(el.querySelector('.ui-icon')).toBeNull();
    expect(el.textContent).toContain('Goblin');
    expect(el.textContent).toContain('Stairs down');
    // No raw glyph notation anywhere — the legend is sprite/name-based now.
    expect(el.textContent).not.toContain('@');
  });

  it('keeps the stats and controls tables', () => {
    const { el } = createHelp(document.body);
    expect(el.textContent).toContain('KEY');
    expect(el.textContent).toContain('Arrows / WASD');
    expect(el.textContent).toContain('Escape');
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createHud } from '../src/ui/hud.js';
import { createMessageLog } from '../src/ui/messageLog.js';
import { APP_VERSION } from '../src/ui/version.js';

function stateWith(player, extra = {}) {
  return {
    entities: { playerId: 1, byId: new Map([[1, { id: 1, kind: 'player', ...player }]]) },
    floor: 1,
    log: [],
    ...extra,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('HUD', () => {
  it('renders HP, floor, and only the earned stats', () => {
    const { update, el } = createHud(document.body);
    update(stateWith({ hp: 14, maxHp: 20, strength: 2, skill: 0, armor: 1 }, { floor: 3 }));
    expect(el.textContent).toContain('HP');
    expect(el.textContent).toContain('14');
    expect(el.textContent).toContain('/20');
    expect(el.textContent).toContain('Floor');
    expect(el.textContent).toContain('3');
    expect(el.textContent).toContain('STR');
    expect(el.textContent).toContain('+2');
    expect(el.textContent).toContain('ARM');
    // skill is 0, so no SKL readout yet
    expect(el.textContent).not.toContain('SKL');
  });

  it('colors the HP number by ratio via the CSS palette (good > 50%, bad <= 25%)', () => {
    const { update, el } = createHud(document.body);
    update(stateWith({ hp: 20, maxHp: 20, strength: 0, skill: 0, armor: 0 }));
    expect(el.querySelector('b').getAttribute('style')).toContain('var(--c-good)');
    update(stateWith({ hp: 4, maxHp: 20, strength: 0, skill: 0, armor: 0 }));
    expect(el.querySelector('b').getAttribute('style')).toContain('var(--c-bad)');
  });

  it('exposes a static version watermark', () => {
    createHud(document.body);
    const v = document.getElementById('hudversion');
    expect(v).toBeTruthy();
    expect(v.textContent).toBe(`v${APP_VERSION}`);
    expect(typeof APP_VERSION).toBe('string');
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });
});

describe('message log', () => {
  const log = (entries) => ({ log: entries });

  it('formats combat lines in plain language, attacker-aware', () => {
    const { update, el } = createMessageLog(document.body);
    update(
      log([
        { type: 'hit', data: { attacker: 'player', target: 'goblin', damage: 5 } },
        { type: 'hit', data: { attacker: 'goblin', target: 'player', damage: 3 } },
        { type: 'miss', data: { attacker: 'player', target: 'skeleton' } },
      ]),
    );
    expect(el.textContent).toContain('You hit the goblin for 5.');
    expect(el.textContent).toContain('The goblin hits you for 3.');
    expect(el.textContent).toContain('You miss the skeleton.');
  });

  it('describes each chest effect and shows at most the last 6 lines', () => {
    const { update, el } = createMessageLog(document.body);
    const entries = [];
    for (let i = 0; i < 8; i++) entries.push({ type: 'descend', data: { floor: i + 2 } });
    entries.push({ type: 'pickup', data: { item: 'chest', effect: 'skill', amount: 1 } });
    update(log(entries));
    expect(el.querySelectorAll('.line').length).toBeLessThanOrEqual(6);
    expect(el.textContent).toContain('+1 Skill');
    // the earliest descend lines fell off the 6-line window
    expect(el.textContent).not.toContain('floor 2.');
  });
});

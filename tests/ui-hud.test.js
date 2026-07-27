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

  it('shows key and ring chips only when held, with injected icons', () => {
    const iconFor = (kind) => {
      const s = document.createElement('span');
      s.className = 'ui-icon';
      s.dataset.kind = kind;
      return s;
    };
    const { update, el } = createHud(document.body, { iconFor });
    update(stateWith({ hp: 20, maxHp: 20, strength: 0, skill: 0, armor: 0 }));
    expect(el.textContent).not.toContain('KEY');
    expect(el.textContent).not.toContain('Shadow');
    update(
      stateWith({
        hp: 20,
        maxHp: 20,
        strength: 0,
        skill: 0,
        armor: 0,
        keys: 2,
        ringShadow: true,
        ringSpeed: true,
      }),
    );
    expect(el.textContent).toContain('KEY');
    expect(el.textContent).toContain('×2');
    expect(el.textContent).toContain('Shadow');
    expect(el.textContent).toContain('Speed');
    expect(el.textContent).not.toContain('Sight');
    expect(el.querySelector('[data-kind="key"]')).toBeTruthy();
    expect(el.querySelector('[data-kind="ring:shadow"]')).toBeTruthy();
  });

  it('key and ring chips degrade to text without an icon injection', () => {
    const { update, el } = createHud(document.body);
    update(
      stateWith({ hp: 20, maxHp: 20, strength: 0, skill: 0, armor: 0, keys: 1, ringSight: true }),
    );
    expect(el.textContent).toContain('KEY');
    expect(el.textContent).toContain('Sight');
    expect(el.querySelector('.ui-icon')).toBeNull();
  });

  it('renders hostile values as text, never as markup', () => {
    // The HUD's numbers are internal today; this pins the boundary so a future
    // source of player- or network-controlled data can't turn it into a sink.
    const hostile = '<img src=x onerror="window.__pwned=1">';
    const { update, el } = createHud(document.body);
    update(
      stateWith(
        { hp: 20, maxHp: 20, strength: hostile, skill: 0, armor: 0 },
        { floor: `1${hostile}` },
      ),
    );
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain(hostile); // shown literally
    expect(window.__pwned).toBeUndefined();
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

  it('renders hostile log data as text, never as markup', () => {
    // Log lines embed data from the entries (enemy names, ring names). They are
    // internal today; this pins the boundary before saves/mods/network data
    // can reach it.
    const hostile = '<img src=x onerror="window.__pwned=1">';
    const { update, el } = createMessageLog(document.body);
    update(
      log([
        { type: 'hit', data: { attacker: 'player', target: hostile, damage: 5 } },
        { type: 'pickup', data: { item: 'ring', ring: hostile } },
      ]),
    );
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain(hostile);
    expect(window.__pwned).toBeUndefined();
  });

  it('narrates the secrets: glimmer, locked, unlock, key, ring, survival', () => {
    const { update, el } = createMessageLog(document.body);
    update(
      log([
        { type: 'reveal', data: {} },
        { type: 'locked', data: {} },
        { type: 'unlock', data: { ring: 'shadow' } },
        { type: 'pickup', data: { item: 'key' } },
        { type: 'pickup', data: { item: 'ring', ring: 'shadow' } },
        { type: 'survival', data: {} },
      ]),
    );
    expect(el.textContent).toContain('A glimmer catches your eye.');
    expect(el.textContent).toContain('The chest is locked — you need a key.');
    expect(el.textContent).toContain('a ring tumbles out!');
    expect(el.textContent).toContain('You pick up a golden key.');
    expect(el.textContent).toContain('You slip on the Ring of Shadow.');
    expect(el.textContent).toContain('crumbles to dust');
  });
});

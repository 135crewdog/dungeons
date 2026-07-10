import { describe, it, expect } from 'vitest';
import { resolveAttack, areHostile } from '../src/systems/combat.js';
import { createRng } from '../src/core/rng.js';

function combatState(seed, { attackerDamage = 3, targetHp = 10, targetKind = 'goblin' } = {}) {
  const rng = createRng(seed);
  const attacker = { id: 1, kind: 'player', x: 0, y: 0, hp: 20, maxHp: 20, damage: attackerDamage, glyph: '@' };
  const target = { id: 2, kind: targetKind, x: 1, y: 0, hp: targetHp, maxHp: targetHp, damage: 2, glyph: 'g' };
  const state = {
    rng,
    status: 'playing',
    turn: 0,
    log: [],
    entities: { nextId: 3, playerId: 1, byId: new Map([[1, attacker], [2, target]]) },
  };
  return { state, attacker, target };
}

describe('combat', () => {
  it('hits about 75% of the time over many attacks (deterministic per seed)', () => {
    const { state, target } = combatState(2024, { attackerDamage: 0, targetHp: 1e9 });
    let hits = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const evs = resolveAttack(state, 1, 2);
      if (evs[0].hit) hits++;
    }
    const rate = hits / n;
    expect(rate).toBeGreaterThan(0.72);
    expect(rate).toBeLessThan(0.78);
  });

  it('a hit subtracts damage; a miss leaves HP unchanged', () => {
    const { state, target } = combatState(7, { attackerDamage: 4, targetHp: 100 });
    const before = target.hp;
    const evs = resolveAttack(state, 1, 2);
    if (evs[0].hit) expect(target.hp).toBe(before - 4);
    else expect(target.hp).toBe(before);
  });

  it('kills an enemy at 0 HP: death event + removed from the state', () => {
    const { state } = combatState(3, { attackerDamage: 100, targetHp: 1 });
    let died = false;
    for (let i = 0; i < 30 && !died; i++) {
      const evs = resolveAttack(state, 1, 2);
      died = evs.some((e) => e.type === 'death');
    }
    expect(died).toBe(true);
    expect(state.entities.byId.has(2)).toBe(false);
  });

  it('never drives HP below zero', () => {
    const { state, target } = combatState(9, { attackerDamage: 100, targetHp: 5 });
    resolveAttack(state, 1, 2);
    // Either a miss (hp 5) or a lethal hit clamped to 0.
    expect(target.hp).toBeGreaterThanOrEqual(0);
  });

  it('player death sets status dead and keeps the player entity', () => {
    // Enemy attacks the player; give a huge hit so any hit is lethal.
    const rng = createRng(11);
    const enemy = { id: 1, kind: 'skeleton', x: 0, y: 0, hp: 10, maxHp: 10, damage: 100, glyph: 's' };
    const player = { id: 2, kind: 'player', x: 1, y: 0, hp: 5, maxHp: 5, damage: 4, glyph: '@' };
    const state = {
      rng,
      status: 'playing',
      turn: 0,
      log: [],
      entities: { nextId: 3, playerId: 2, byId: new Map([[1, enemy], [2, player]]) },
    };
    for (let i = 0; i < 30 && state.status === 'playing'; i++) resolveAttack(state, 1, 2);
    expect(state.status).toBe('dead');
    expect(state.entities.byId.has(2)).toBe(true); // player kept for the game-over frame
  });

  it('areHostile is true only across the player/enemy line', () => {
    const player = { kind: 'player' };
    const goblin = { kind: 'goblin' };
    const skeleton = { kind: 'skeleton' };
    expect(areHostile(player, goblin)).toBe(true);
    expect(areHostile(goblin, player)).toBe(true);
    expect(areHostile(goblin, skeleton)).toBe(false);
  });
});

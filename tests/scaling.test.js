import { describe, it, expect } from 'vitest';
import { createEnemy } from '../src/entities/enemies.js';
import { createGame, descend } from '../src/core/gameState.js';
import { createRng } from '../src/core/rng.js';
import { resolveAttack } from '../src/systems/combat.js';
import { ENEMY_TYPES } from '../src/core/constants.js';

describe('depth scaling — regular enemies', () => {
  it('floor 1 is the unscaled baseline: d4 and base HP', () => {
    const g = createEnemy(ENEMY_TYPES.goblin, 0, 0, 1);
    expect(g.maxHp).toBe(6);
    expect(g.attackDie).toBe(4);
    const s = createEnemy(ENEMY_TYPES.skeleton, 0, 0); // default floor
    expect(s.maxHp).toBe(3);
    expect(s.attackDie).toBe(4);
  });

  it('climbs the die ladder one rung per 4 floors and gains +1 max HP per 2 floors', () => {
    const dieAt = (floor) => createEnemy(ENEMY_TYPES.goblin, 0, 0, floor).attackDie;
    expect(dieAt(4)).toBe(4); // floors 1-4: d4
    expect(dieAt(5)).toBe(6); // floors 5-8: d6
    expect(dieAt(9)).toBe(8); // floors 9-12: d8
    expect(dieAt(13)).toBe(10); // floors 13-16: d10
    expect(dieAt(40)).toBe(10); // clamped at the last rung

    const g7 = createEnemy(ENEMY_TYPES.goblin, 0, 0, 7);
    expect(g7.maxHp).toBe(6 + 3); // floors 3,5,7
    expect(g7.hp).toBe(g7.maxHp);
    expect(g7.attackDie).toBe(6);
    const s7 = createEnemy(ENEMY_TYPES.skeleton, 0, 0, 7);
    expect(s7.maxHp).toBe(3 + 3);
    expect(s7.attackDie).toBe(g7.attackDie); // same rung, same die
  });
});

describe('depth scaling — boss tiers', () => {
  it('tier 1 (floor 5) is the base boss rolling the player\'s own d8', () => {
    const b = createEnemy(ENEMY_TYPES.boss, 0, 0, 5);
    expect(b).toMatchObject({ maxHp: 24, attackDie: 8 });
  });

  it('each lair adds 12 HP and steps up BOSS_DICE, clamped at d20', () => {
    const b10 = createEnemy(ENEMY_TYPES.boss, 0, 0, 10);
    expect(b10).toMatchObject({ maxHp: 36, hp: 36, attackDie: 12 });
    const b15 = createEnemy(ENEMY_TYPES.boss, 0, 0, 15);
    expect(b15).toMatchObject({ maxHp: 48, attackDie: 20 });
    const b20 = createEnemy(ENEMY_TYPES.boss, 0, 0, 20);
    expect(b20).toMatchObject({ maxHp: 60, attackDie: 20 }); // die clamped, HP keeps growing
  });
});

describe('depth scaling — combat integration', () => {
  it('a deep goblin actually swings its bigger die', () => {
    const attacker = { x: 0, y: 0, ...createEnemy(ENEMY_TYPES.goblin, 0, 0, 9) };
    attacker.id = 1;
    const target = { id: 2, kind: 'player', x: 1, y: 0, hp: 1e9, maxHp: 1e9, attackDie: 8, strength: 0, armor: 0, glyph: '@' };
    const state = {
      rng: createRng(99),
      status: 'playing',
      turn: 0,
      log: [],
      items: [],
      entities: { nextId: 3, playerId: 2, byId: new Map([[1, attacker], [2, target]]) },
    };
    const damages = [];
    for (let i = 0; i < 300; i++) {
      const [ev] = resolveAttack(state, 1, 2);
      if (ev.hit) damages.push(ev.damage);
    }
    expect(Math.min(...damages)).toBe(1);
    expect(Math.max(...damages)).toBe(8); // d8 at floor 9
    expect(new Set(damages).size).toBe(8);
  });
});

describe('depth scaling — full game integration', () => {
  it('floor 10 spawns d8 regulars and a d12 tier-2 boss', () => {
    const state = createGame(2025);
    for (let f = 2; f <= 10; f++) descend(state);
    expect(state.floor).toBe(10);
    const enemies = [...state.entities.byId.values()].filter((e) => e.kind !== 'player');
    const boss = enemies.find((e) => e.kind === 'boss');
    expect(boss).toMatchObject({ maxHp: 36, attackDie: 12 });
    for (const e of enemies.filter((e) => e.kind !== 'boss')) {
      expect(e.maxHp).toBe((e.kind === 'goblin' ? 6 : 3) + 4); // floors 3,5,7,9
      expect(e.attackDie).toBe(8); // floors 9-12 rung
    }
  });
});

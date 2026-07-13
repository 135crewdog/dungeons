import { describe, it, expect } from 'vitest';
import { createEnemy } from '../src/entities/enemies.js';
import { createGame, descend } from '../src/core/gameState.js';
import { createRng } from '../src/core/rng.js';
import { resolveAttack } from '../src/systems/combat.js';
import { ENEMY_TYPES } from '../src/core/constants.js';

describe('depth scaling — regular enemies', () => {
  it('floor 1 is the unscaled baseline', () => {
    const g = createEnemy(ENEMY_TYPES.goblin, 0, 0, 1);
    expect(g.maxHp).toBe(5);
    expect(g.dmgBonus).toBe(0);
    const s = createEnemy(ENEMY_TYPES.skeleton, 0, 0); // default floor
    expect(s.maxHp).toBe(3);
    expect(s.dmgBonus).toBe(0);
  });

  it('gains +1 max HP per 2 floors and +1 damage per 3 floors', () => {
    const g7 = createEnemy(ENEMY_TYPES.goblin, 0, 0, 7);
    expect(g7.maxHp).toBe(5 + 3); // floors 3,5,7
    expect(g7.hp).toBe(g7.maxHp);
    expect(g7.dmgBonus).toBe(2); // floors 4,7
    const s7 = createEnemy(ENEMY_TYPES.skeleton, 0, 0, 7);
    expect(s7.maxHp).toBe(3 + 3);
    expect(s7.dmgBonus).toBe(2);
  });
});

describe('depth scaling — boss tiers', () => {
  it('tier 1 (floor 5) is the base boss with the floor damage drip', () => {
    const b = createEnemy(ENEMY_TYPES.boss, 0, 0, 5);
    expect(b).toMatchObject({ maxHp: 30, damageMult: 2, dmgBonus: 1 });
  });

  it('each lair adds 15 HP and +1 to the damage multiplier', () => {
    const b10 = createEnemy(ENEMY_TYPES.boss, 0, 0, 10);
    expect(b10).toMatchObject({ maxHp: 45, hp: 45, damageMult: 3, dmgBonus: 3 });
    const b15 = createEnemy(ENEMY_TYPES.boss, 0, 0, 15);
    expect(b15).toMatchObject({ maxHp: 60, damageMult: 4, dmgBonus: 4 });
  });
});

describe('depth scaling — combat integration', () => {
  function duel(attacker) {
    const target = { id: 2, kind: 'player', x: 1, y: 0, hp: 1e9, maxHp: 1e9, damage: 4, strength: 0, armor: 0, glyph: '@' };
    const state = {
      rng: createRng(99),
      status: 'playing',
      turn: 0,
      log: [],
      items: [],
      entities: { nextId: 3, playerId: 2, byId: new Map([[1, { id: 1, x: 0, y: 0, ...attacker }], [2, target]]) },
    };
    const damages = [];
    for (let i = 0; i < 200; i++) {
      const evs = resolveAttack(state, 1, 2);
      if (evs[0].hit) damages.push(evs[0].damage);
    }
    return damages;
  }

  it('the flat bonus rides on top of every die roll', () => {
    const damages = duel({ kind: 'goblin', hp: 5, maxHp: 5, damageDie: 4, damageMult: 1, dmgBonus: 2, glyph: 'g' });
    expect(Math.min(...damages)).toBeGreaterThanOrEqual(3); // 1+2
    expect(Math.max(...damages)).toBeLessThanOrEqual(6); // 4+2
  });

  it('a tier-2 boss hits for 3xd4 plus its floor bonus', () => {
    const damages = duel({ kind: 'boss', hp: 45, maxHp: 45, damageDie: 4, damageMult: 3, dmgBonus: 3, glyph: 'B' });
    expect(Math.min(...damages)).toBeGreaterThanOrEqual(6); // 3*1+3
    expect(Math.max(...damages)).toBeLessThanOrEqual(15); // 3*4+3
    expect(new Set(damages).size).toBeGreaterThanOrEqual(3);
  });
});

describe('depth scaling — full game integration', () => {
  it('floor 10 spawns scaled regulars and a tier-2 boss', () => {
    const state = createGame(2025);
    for (let f = 2; f <= 10; f++) descend(state);
    expect(state.floor).toBe(10);
    const enemies = [...state.entities.byId.values()].filter((e) => e.kind !== 'player');
    const boss = enemies.find((e) => e.kind === 'boss');
    expect(boss).toMatchObject({ maxHp: 45, damageMult: 3, dmgBonus: 3 });
    for (const e of enemies.filter((e) => e.kind !== 'boss')) {
      expect(e.maxHp).toBe((e.kind === 'goblin' ? 5 : 3) + 4); // floors 3,5,7,9
      expect(e.dmgBonus).toBe(3); // floors 4,7,10
    }
  });
});

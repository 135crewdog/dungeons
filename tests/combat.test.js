import { describe, it, expect } from 'vitest';
import { resolveAttack, areHostile, mitigatedDamage } from '../src/systems/combat.js';
import { createRng, chance, nextInt } from '../src/core/rng.js';
import { createPlayer } from '../src/entities/player.js';

function combatState(
  seed,
  {
    attackerDamage = 3,
    attackerDamageDie,
    attackerDamageMult,
    attackerStrength = 0,
    targetHp = 10,
    targetArmor = 0,
    targetKind = 'goblin',
  } = {},
) {
  const rng = createRng(seed);
  const attacker = {
    id: 1, kind: 'player', x: 0, y: 0, hp: 20, maxHp: 20,
    damage: attackerDamage, damageDie: attackerDamageDie, damageMult: attackerDamageMult,
    strength: attackerStrength, glyph: '@',
  };
  const target = { id: 2, kind: targetKind, x: 1, y: 0, hp: targetHp, maxHp: targetHp, damage: 2, armor: targetArmor, glyph: 'g' };
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

  it('strength adds to the damage dealt on a hit', () => {
    const { state, target } = combatState(7, { attackerDamage: 3, attackerStrength: 2, targetHp: 100 });
    const before = target.hp;
    const evs = resolveAttack(state, 1, 2);
    if (evs[0].hit) expect(target.hp).toBe(before - 5);
    else expect(target.hp).toBe(before);
  });

  it('armor reduces the damage taken on a hit', () => {
    const { state, target } = combatState(7, { attackerDamage: 4, targetHp: 100, targetArmor: 2 });
    const before = target.hp;
    const evs = resolveAttack(state, 1, 2);
    if (evs[0].hit) expect(target.hp).toBe(before - 2);
    else expect(target.hp).toBe(before);
  });

  it('armor never reduces a real hit below 1 damage', () => {
    const { state, target } = combatState(7, { attackerDamage: 2, targetHp: 100, targetArmor: 5 });
    const before = target.hp;
    const evs = resolveAttack(state, 1, 2);
    if (evs[0].hit) expect(target.hp).toBe(before - 1);
    else expect(target.hp).toBe(before);
  });

  it('a zero-damage attack stays zero even against armor', () => {
    const { state, target } = combatState(2024, { attackerDamage: 0, targetHp: 100, targetArmor: 3 });
    for (let i = 0; i < 20; i++) resolveAttack(state, 1, 2); // guaranteed to include hits
    expect(target.hp).toBe(100);
  });

  it('a damage die rolls fresh per landed hit, always within 1..die', () => {
    const { state } = combatState(42, { attackerDamageDie: 4, targetHp: 1e9 });
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const evs = resolveAttack(state, 1, 2);
      if (!evs[0].hit) continue;
      expect(evs[0].damage).toBeGreaterThanOrEqual(1);
      expect(evs[0].damage).toBeLessThanOrEqual(4);
      seen.add(evs[0].damage);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3); // varies per hit, not fixed per entity
  });

  it('a damage multiplier doubles the die roll (boss: 2/4/6/8)', () => {
    const { state } = combatState(42, { attackerDamageDie: 4, attackerDamageMult: 2, targetHp: 1e9 });
    for (let i = 0; i < 200; i++) {
      const evs = resolveAttack(state, 1, 2);
      if (evs[0].hit) expect([2, 4, 6, 8]).toContain(evs[0].damage);
    }
  });

  it('strength stacks on top of a damage die', () => {
    const { state } = combatState(42, { attackerDamageDie: 4, attackerStrength: 2, targetHp: 1e9 });
    for (let i = 0; i < 100; i++) {
      const evs = resolveAttack(state, 1, 2);
      if (evs[0].hit) {
        expect(evs[0].damage).toBeGreaterThanOrEqual(3);
        expect(evs[0].damage).toBeLessThanOrEqual(6);
      }
    }
  });

  it('rolls the die only after a hit, one draw per landed hit (RNG order locked)', () => {
    const { state } = combatState(1337, { attackerDamageDie: 4, targetHp: 1e9 });
    // Replay the exact same draws by hand on a twin RNG: hit roll first, then
    // one die draw only when the hit landed.
    const twin = createRng(1337);
    for (let i = 0; i < 300; i++) {
      const evs = resolveAttack(state, 1, 2);
      const hit = chance(twin, 0.75);
      expect(evs[0].hit).toBe(hit);
      if (hit) expect(evs[0].damage).toBe(nextInt(twin, 1, 4));
    }
  });

  it('the player rolls d4+2 per landed hit: 3..6, varying, plus strength', () => {
    const player = { ...createPlayer(0, 0), id: 1 };
    const target = { id: 2, kind: 'goblin', x: 1, y: 0, hp: 1e9, maxHp: 1e9, damage: 2, armor: 0, glyph: 'g' };
    const state = {
      rng: createRng(42),
      status: 'playing',
      turn: 0,
      log: [],
      entities: { nextId: 3, playerId: 1, byId: new Map([[1, player], [2, target]]) },
    };
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const evs = resolveAttack(state, 1, 2);
      if (!evs[0].hit) continue;
      expect(evs[0].damage).toBeGreaterThanOrEqual(3);
      expect(evs[0].damage).toBeLessThanOrEqual(6);
      seen.add(evs[0].damage);
    }
    expect(seen.size).toBe(4); // the die actually rolls, not a flat number

    player.strength = 2; // chest bonuses shift the whole range
    const evs = [];
    while (evs.length < 20) {
      const e = resolveAttack(state, 1, 2)[0];
      if (e.hit) evs.push(e);
    }
    for (const e of evs) {
      expect(e.damage).toBeGreaterThanOrEqual(5);
      expect(e.damage).toBeLessThanOrEqual(8);
    }
  });

  it('mitigatedDamage floors real hits at 1 and passes zero through', () => {
    expect(mitigatedDamage(0, 5)).toBe(0);
    expect(mitigatedDamage(-1, 0)).toBe(0);
    expect(mitigatedDamage(2, 5)).toBe(1);
    expect(mitigatedDamage(4, 1)).toBe(3);
    expect(mitigatedDamage(4, 0)).toBe(4);
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

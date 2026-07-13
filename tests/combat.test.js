import { describe, it, expect } from 'vitest';
import { resolveAttack, areHostile, mitigatedDamage } from '../src/systems/combat.js';
import { createRng, nextInt } from '../src/core/rng.js';
import { createPlayer } from '../src/entities/player.js';
import { HIT_DIE, HIT_THRESHOLD } from '../src/core/constants.js';

// Two-roll combat: d20 to hit (natural 1 always misses; otherwise
// roll + skill >= HIT_THRESHOLD), then damage die + strength − armor (min 1).

function combatState(
  seed,
  {
    attackerDie = 8,
    attackerSkill = 0,
    attackerStrength = 0,
    targetHp = 10,
    targetArmor = 0,
    targetKind = 'goblin',
  } = {},
) {
  const rng = createRng(seed);
  const attacker = {
    id: 1, kind: 'player', x: 0, y: 0, hp: 20, maxHp: 20,
    attackDie: attackerDie, skill: attackerSkill, strength: attackerStrength, glyph: '@',
  };
  const target = { id: 2, kind: targetKind, x: 1, y: 0, hp: targetHp, maxHp: targetHp, attackDie: 4, armor: targetArmor, glyph: 'g' };
  const state = {
    rng,
    status: 'playing',
    turn: 0,
    log: [],
    items: [],
    entities: { nextId: 3, playerId: 1, byId: new Map([[1, attacker], [2, target]]) },
  };
  return { state, attacker, target };
}

function hitRate(state, n) {
  let hits = 0;
  for (let i = 0; i < n; i++) {
    if (resolveAttack(state, 1, 2)[0].hit) hits++;
  }
  return hits / n;
}

describe('to-hit roll', () => {
  it('hits about 75% of the time at skill 0 (roll 6+ on a d20)', () => {
    const { state } = combatState(2024, { targetHp: 1e9 });
    const rate = hitRate(state, 4000);
    expect(rate).toBeGreaterThan(0.72);
    expect(rate).toBeLessThan(0.78);
  });

  it('each skill point adds one face — about +5% to hit', () => {
    const at = (skill) => {
      const { state } = combatState(2024, { targetHp: 1e9, attackerSkill: skill });
      return hitRate(state, 4000);
    };
    expect(at(2)).toBeGreaterThan(0.82);
    expect(at(2)).toBeLessThan(0.88);
  });

  it('a natural 1 always misses, so accuracy caps at 95% even at huge skill', () => {
    const { state } = combatState(7, { targetHp: 1e9, attackerSkill: 100 });
    const rate = hitRate(state, 4000);
    expect(rate).toBeGreaterThan(0.92);
    expect(rate).toBeLessThan(0.98);
  });

  it('every attack event carries the visible to-hit roll', () => {
    const { state } = combatState(5, { targetHp: 1e9 });
    for (let i = 0; i < 50; i++) {
      const [ev] = resolveAttack(state, 1, 2);
      expect(ev.roll).toBeGreaterThanOrEqual(1);
      expect(ev.roll).toBeLessThanOrEqual(HIT_DIE);
      if (ev.hit) expect(ev.roll + 0).toBeGreaterThanOrEqual(HIT_THRESHOLD);
      else expect(ev.roll === 1 || ev.roll < HIT_THRESHOLD).toBe(true);
    }
  });
});

describe('damage roll', () => {
  it('a hit subtracts the rolled damage; a miss leaves HP unchanged', () => {
    const { state, target } = combatState(7, { targetHp: 100 });
    const before = target.hp;
    const [ev] = resolveAttack(state, 1, 2);
    if (ev.hit) expect(target.hp).toBe(before - ev.damage);
    else expect(target.hp).toBe(before);
  });

  it('rolls fresh within 1..die on every landed hit', () => {
    const { state } = combatState(42, { attackerDie: 4, targetHp: 1e9 });
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const [ev] = resolveAttack(state, 1, 2);
      if (!ev.hit) continue;
      expect(ev.damage).toBeGreaterThanOrEqual(1);
      expect(ev.damage).toBeLessThanOrEqual(4);
      seen.add(ev.damage);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3); // varies per hit, not fixed per entity
  });

  it('the player rolls a d8 that shifts with strength', () => {
    const player = { ...createPlayer(0, 0), id: 1 };
    const target = { id: 2, kind: 'goblin', x: 1, y: 0, hp: 1e9, maxHp: 1e9, attackDie: 4, armor: 0, glyph: 'g' };
    const state = {
      rng: createRng(42),
      status: 'playing',
      turn: 0,
      log: [],
      items: [],
      entities: { nextId: 3, playerId: 1, byId: new Map([[1, player], [2, target]]) },
    };
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const [ev] = resolveAttack(state, 1, 2);
      if (!ev.hit) continue;
      expect(ev.damage).toBeGreaterThanOrEqual(1);
      expect(ev.damage).toBeLessThanOrEqual(8);
      seen.add(ev.damage);
    }
    expect(seen.size).toBe(8);

    player.strength = 2; // chest bonuses shift the whole range
    for (let landed = 0; landed < 20; ) {
      const [ev] = resolveAttack(state, 1, 2);
      if (!ev.hit) continue;
      landed++;
      expect(ev.damage).toBeGreaterThanOrEqual(3);
      expect(ev.damage).toBeLessThanOrEqual(10);
    }
  });

  it('armor reduces damage but a landed hit always costs at least 1', () => {
    const { state } = combatState(7, { attackerDie: 4, targetHp: 1e9, targetArmor: 100 });
    for (let landed = 0; landed < 20; ) {
      const [ev] = resolveAttack(state, 1, 2);
      if (!ev.hit) continue;
      landed++;
      expect(ev.damage).toBe(1);
    }
  });

  it('rolls to hit first, damage only on a landed hit (RNG order locked)', () => {
    const { state } = combatState(1337, { attackerDie: 8, targetHp: 1e9 });
    // Replay the exact same draws by hand on a twin RNG.
    const twin = createRng(1337);
    for (let i = 0; i < 300; i++) {
      const [ev] = resolveAttack(state, 1, 2);
      const roll = nextInt(twin, 1, HIT_DIE);
      const hit = roll > 1 && roll >= HIT_THRESHOLD;
      expect(ev.hit).toBe(hit);
      expect(ev.roll).toBe(roll);
      if (hit) expect(ev.damage).toBe(nextInt(twin, 1, 8));
    }
  });
});

describe('death and factions', () => {
  it('kills an enemy at 0 HP: death event + removed from the state', () => {
    const { state } = combatState(3, { attackerStrength: 100, targetHp: 1 });
    let died = false;
    for (let i = 0; i < 30 && !died; i++) {
      died = resolveAttack(state, 1, 2).some((e) => e.type === 'death');
    }
    expect(died).toBe(true);
    expect(state.entities.byId.has(2)).toBe(false);
  });

  it('never drives HP below zero', () => {
    const { state, target } = combatState(9, { attackerStrength: 100, targetHp: 5 });
    resolveAttack(state, 1, 2);
    expect(target.hp).toBeGreaterThanOrEqual(0);
  });

  it('player death sets status dead and keeps the player entity', () => {
    const rng = createRng(11);
    const enemy = { id: 1, kind: 'skeleton', x: 0, y: 0, hp: 10, maxHp: 10, attackDie: 4, strength: 100, glyph: 's' };
    const player = { id: 2, kind: 'player', x: 1, y: 0, hp: 5, maxHp: 5, attackDie: 8, glyph: '@' };
    const state = {
      rng,
      status: 'playing',
      turn: 0,
      log: [],
      items: [],
      entities: { nextId: 3, playerId: 2, byId: new Map([[1, enemy], [2, player]]) },
    };
    for (let i = 0; i < 30 && state.status === 'playing'; i++) resolveAttack(state, 1, 2);
    expect(state.status).toBe('dead');
    expect(state.entities.byId.has(2)).toBe(true); // kept for the game-over frame
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

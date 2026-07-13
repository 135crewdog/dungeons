import { describe, it, expect } from 'vitest';
import { createGame, descend, ascend } from '../src/core/gameState.js';
import { getPlayer, idx } from '../src/core/query.js';
import { createRng } from '../src/core/rng.js';
import { resolveAttack } from '../src/systems/combat.js';
import { SPAWNABLE_ENEMIES } from '../src/entities/enemies.js';
import {
  ENEMY_TYPES,
  BOSS_FLOOR_INTERVAL,
  CHEST_STRENGTH_BONUS,
  CHEST_ARMOR_BONUS,
  CHEST_HEALTH_BONUS,
  TILE,
} from '../src/core/constants.js';

const bosses = (state) =>
  [...state.entities.byId.values()].filter((e) => e.kind === 'boss');

describe('boss spawning', () => {
  it('never enters the random spawn pool', () => {
    expect(SPAWNABLE_ENEMIES.map((t) => t.kind).sort()).toEqual(['goblin', 'skeleton']);
  });

  it.each([11, 4242, 987654])(
    'seed %i: exactly one boss on every 5th floor, in the down-stairs room, none elsewhere',
    (seed) => {
      const state = createGame(seed);
      for (let floor = 1; floor <= 2 * BOSS_FLOOR_INTERVAL; floor++) {
        if (floor > 1) descend(state);
        expect(state.floor).toBe(floor);
        const found = bosses(state);
        if (floor % BOSS_FLOOR_INTERVAL === 0) {
          expect(found).toHaveLength(1);
          const boss = found[0];
          const map = state.map;
          const stairsRoomId = map.roomAt[idx(map, map.stairsDown.x, map.stairsDown.y)];
          expect(map.roomAt[idx(map, boss.x, boss.y)]).toBe(stairsRoomId);
        } else {
          expect(found).toHaveLength(0);
        }
      }
    },
  );

  it('spawns with the boss stat block', () => {
    const state = createGame(7);
    for (let i = 1; i < BOSS_FLOOR_INTERVAL; i++) descend(state);
    const [boss] = bosses(state);
    expect(boss).toMatchObject({
      kind: 'boss',
      glyph: 'B',
      hp: 30,
      maxHp: 30,
      damageDie: 4,
      damageMult: 2,
      moveEvery: 1,
      aggro: false,
    });
  });

  it('a killed boss stays dead on the cached floor', () => {
    const state = createGame(4242);
    for (let i = 1; i < BOSS_FLOOR_INTERVAL; i++) descend(state);
    const [boss] = bosses(state);
    state.entities.byId.delete(boss.id); // "kill" it
    ascend(state);
    descend(state);
    expect(state.floor).toBe(BOSS_FLOOR_INTERVAL);
    expect(bosses(state)).toHaveLength(0); // cached floor, never repopulated
  });
});

describe('boss chest drop', () => {
  // A 4x3 all-floor arena; `bossTile` optionally retypes the boss's tile
  // (e.g. stairs) to test drop placement.
  function bossFight(seed, { bossTile = null } = {}) {
    const rng = createRng(seed);
    const width = 4;
    const height = 3;
    const map = { width, height, tiles: new Uint8Array(width * height).fill(TILE.FLOOR) };
    const player = { id: 1, kind: 'player', x: 0, y: 1, hp: 20, maxHp: 20, damage: 100, strength: 0, armor: 0, glyph: '@' };
    const boss = { id: 2, kind: 'boss', x: 1, y: 1, hp: 30, maxHp: 30, damageDie: 4, damageMult: 2, glyph: 'B' };
    if (bossTile !== null) map.tiles[boss.y * width + boss.x] = bossTile;
    const state = {
      rng,
      status: 'playing',
      turn: 0,
      log: [],
      items: [],
      map,
      entities: { nextId: 3, playerId: 1, byId: new Map([[1, player], [2, boss]]) },
    };
    return { state, boss };
  }

  it('drops exactly one bonus chest on the death tile', () => {
    const { state, boss } = bossFight(3);
    let died = false;
    for (let i = 0; i < 30 && !died; i++) {
      died = resolveAttack(state, 1, 2).some((e) => e.type === 'death');
    }
    expect(died).toBe(true);
    expect(state.entities.byId.has(2)).toBe(false);
    expect(state.items).toHaveLength(1);
    const chest = state.items[0];
    expect(chest).toMatchObject({ type: 'chest', x: boss.x, y: boss.y });
    expect(chest.id).toBeGreaterThan(0);
  });

  it('a boss dying on the stairs drops the chest on an adjacent floor tile instead', () => {
    // Stairs swallow pickups (stepping onto them changes floor before pickups
    // resolve), so a stair-tile death must not strand the reward there.
    const { state, boss } = bossFight(3, { bossTile: TILE.STAIRS_DOWN });
    for (let i = 0; i < 30 && state.entities.byId.has(2); i++) resolveAttack(state, 1, 2);
    expect(state.items).toHaveLength(1);
    const chest = state.items[0];
    expect(chest.x === boss.x && chest.y === boss.y).toBe(false); // not on the stairs
    expect(Math.max(Math.abs(chest.x - boss.x), Math.abs(chest.y - boss.y))).toBe(1); // adjacent
    expect(state.map.tiles[chest.y * state.map.width + chest.x]).toBe(TILE.FLOOR);
  });

  it('never drops a trap; all three bonuses occur across seeds', () => {
    const bonusFor = { strength: CHEST_STRENGTH_BONUS, armor: CHEST_ARMOR_BONUS, health: CHEST_HEALTH_BONUS };
    const seen = new Set();
    for (let seed = 1; seed <= 200; seed++) {
      const { state } = bossFight(seed);
      for (let i = 0; i < 30 && state.entities.byId.has(2); i++) resolveAttack(state, 1, 2);
      const [chest] = state.items;
      expect(chest.effect).not.toBe('trap');
      expect(chest.amount).toBe(bonusFor[chest.effect]);
      seen.add(chest.effect);
    }
    expect([...seen].sort()).toEqual(['armor', 'health', 'strength']);
  });
});

describe('boss constants', () => {
  it('is twice a goblin in damage and part of ENEMY_TYPES for stats only', () => {
    expect(ENEMY_TYPES.boss.damageDie).toBe(ENEMY_TYPES.goblin.damageDie);
    expect(ENEMY_TYPES.boss.damageMult).toBe(2);
  });
});

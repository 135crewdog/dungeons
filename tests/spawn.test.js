// Depth-scaled floor population: enemy counts grow as the player descends and
// the spawn mix drifts toward goblins, per the difficulty-rebalance constants.

import { describe, it, expect } from 'vitest';
import { createGame, descend } from '../src/core/gameState.js';
import { getPlayer } from '../src/core/query.js';
import { createRng } from '../src/core/rng.js';
import { enemyCountFor, goblinShareFor } from '../src/entities/spawn.js';
import {
  MIN_ENEMIES,
  MAX_ENEMIES,
  ENEMY_COUNT_CAP,
  GOBLIN_WEIGHT_BASE,
  GOBLIN_WEIGHT_MAX,
} from '../src/core/constants.js';

describe('enemy count depth scaling', () => {
  it('floor 1 keeps the unscaled band', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const count = enemyCountFor(createRng(seed), 1);
      expect(count).toBeGreaterThanOrEqual(MIN_ENEMIES);
      expect(count).toBeLessThanOrEqual(MAX_ENEMIES);
    }
  });

  it('adds +1 per 3 floors of depth', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const count = enemyCountFor(createRng(seed), 7); // depth bonus 2
      expect(count).toBeGreaterThanOrEqual(MIN_ENEMIES + 2);
      expect(count).toBeLessThanOrEqual(MAX_ENEMIES + 2);
    }
  });

  it('caps at ENEMY_COUNT_CAP on very deep floors', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(enemyCountFor(createRng(seed), 40)).toBe(ENEMY_COUNT_CAP);
    }
  });
});

describe('spawn mix depth weighting', () => {
  it('starts at an even split and drifts toward goblins, capped', () => {
    expect(goblinShareFor(1)).toBe(GOBLIN_WEIGHT_BASE);
    expect(goblinShareFor(5)).toBeGreaterThan(GOBLIN_WEIGHT_BASE);
    expect(goblinShareFor(9)).toBeGreaterThan(goblinShareFor(5));
    expect(goblinShareFor(30)).toBe(GOBLIN_WEIGHT_MAX);
  });

  it('deep floors actually spawn goblin-heavy mixes', () => {
    const tally = (state) => {
      let goblins = 0;
      let skeletons = 0;
      for (const e of state.entities.byId.values()) {
        if (e.kind === 'goblin') goblins++;
        if (e.kind === 'skeleton') skeletons++;
      }
      return { goblins, skeletons };
    };

    let floor1 = { goblins: 0, skeletons: 0 };
    let floor9 = { goblins: 0, skeletons: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      const state = createGame(seed);
      const t1 = tally(state);
      floor1 = { goblins: floor1.goblins + t1.goblins, skeletons: floor1.skeletons + t1.skeletons };
      for (let f = 2; f <= 9; f++) descend(state);
      const t9 = tally(state);
      floor9 = { goblins: floor9.goblins + t9.goblins, skeletons: floor9.skeletons + t9.skeletons };
    }

    const share1 = floor1.goblins / (floor1.goblins + floor1.skeletons);
    const share9 = floor9.goblins / (floor9.goblins + floor9.skeletons);
    expect(share1).toBeGreaterThan(0.38); // ~50% expected on floor 1
    expect(share1).toBeLessThan(0.62);
    expect(share9).toBeGreaterThan(share1); // drift is real
    expect(share9).toBeGreaterThan(0.62); // ~74% expected on floor 9
  });
});

describe('spawn placement', () => {
  it('never spawns enemies in the starting room', () => {
    for (const seed of [7, 99, 512, 2024]) {
      const state = createGame(seed);
      const player = getPlayer(state);
      const start = state.map.rooms[0];
      expect(player.x).toBeGreaterThanOrEqual(start.x);
      expect(player.x).toBeLessThan(start.x + start.w);
      for (const e of state.entities.byId.values()) {
        if (e.id === player.id) continue;
        const inStart =
          e.x >= start.x && e.x < start.x + start.w && e.y >= start.y && e.y < start.y + start.h;
        expect(inStart).toBe(false);
      }
    }
  });
});

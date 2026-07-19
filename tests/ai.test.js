import { describe, it, expect } from 'vitest';
import { enemyTurn } from '../src/systems/ai.js';
import { updateVisibility } from '../src/systems/visibility.js';
import { createEnemy } from '../src/entities/enemies.js';
import { ENEMY_TYPES, TILE, DEAGGRO_TURNS } from '../src/core/constants.js';
import { idx } from '../src/core/query.js';

// An 11x3 corridor along y=1 (x=1..9) with a closed door at x=5. No rooms.
function corridorState({ playerX, enemyX, enemyType = ENEMY_TYPES.goblin }) {
  const width = 11;
  const height = 3;
  const tiles = new Uint8Array(width * height); // all WALL
  const roomAt = new Int16Array(width * height).fill(-1);
  const map = { width, height, tiles, rooms: [], roomAt, stairsDown: null, stairsUp: null };
  for (let x = 1; x <= 9; x++) tiles[idx(map, x, 1)] = TILE.FLOOR;
  tiles[idx(map, 5, 1)] = TILE.DOOR;

  const player = {
    id: 1,
    kind: 'player',
    x: playerX,
    y: 1,
    hp: 20,
    maxHp: 20,
    attackDie: 8,
    glyph: '@',
  };
  const enemy = createEnemy(enemyType, enemyX, 1);
  enemy.id = 2;
  const state = {
    rng: { seed: 1, s: 1 },
    status: 'playing',
    turn: 0,
    log: [],
    items: [],
    map,
    vis: { visible: new Uint8Array(width * height), explored: new Uint8Array(width * height) },
    entities: {
      nextId: 3,
      playerId: 1,
      byId: new Map([
        [1, player],
        [2, enemy],
      ]),
    },
  };
  return { state, player, enemy };
}

// A 7x5 open room (floor at x=1..5, y=1..3) with a single blocker tile at the
// center (3,2): either a stair tile or an item on the floor. Player and enemy
// sit on the middle row on opposite sides, so the only way across is around the
// blocker — exactly what an enemy must do (it can't use stairs or loot).
function blockedRoomState({ blocker }) {
  const width = 7;
  const height = 5;
  const tiles = new Uint8Array(width * height); // all WALL
  const roomAt = new Int16Array(width * height).fill(-1);
  const map = { width, height, tiles, rooms: [], roomAt, stairsDown: null, stairsUp: null };
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 5; x++) tiles[idx(map, x, y)] = TILE.FLOOR;
  }
  const items = [];
  if (blocker === 'stair') {
    tiles[idx(map, 3, 2)] = TILE.STAIRS_DOWN;
    map.stairsDown = { x: 3, y: 2 };
  } else if (blocker === 'item') {
    items.push({ id: 9, type: 'potion', x: 3, y: 2, heal: 5 });
  }
  const player = { id: 1, kind: 'player', x: 1, y: 2, hp: 20, maxHp: 20, attackDie: 8, glyph: '@' };
  const enemy = createEnemy(ENEMY_TYPES.goblin, 5, 2, 1);
  enemy.id = 2;
  const state = {
    rng: { seed: 1, s: 1 },
    status: 'playing',
    turn: 0,
    log: [],
    items,
    map,
    vis: { visible: new Uint8Array(width * height), explored: new Uint8Array(width * height) },
    entities: {
      nextId: 3,
      playerId: 1,
      byId: new Map([
        [1, player],
        [2, enemy],
      ]),
    },
  };
  return { state, player, enemy };
}

describe('enemies route around stairs and items', () => {
  it('never steps onto a stair tile while closing on the player', () => {
    const { state, enemy } = blockedRoomState({ blocker: 'stair' });
    let attacked = false;
    for (let i = 0; i < 8 && !attacked; i++) {
      updateVisibility(state);
      const events = enemyTurn(state, 2);
      expect(enemy.x === 3 && enemy.y === 2).toBe(false); // never on the stairs
      attacked = events.some((e) => e.type === 'attack');
    }
    expect(attacked).toBe(true); // it reached the player by going around
  });

  it('never steps onto an item tile while closing on the player', () => {
    const { state, enemy } = blockedRoomState({ blocker: 'item' });
    let attacked = false;
    for (let i = 0; i < 8 && !attacked; i++) {
      updateVisibility(state);
      const events = enemyTurn(state, 2);
      expect(enemy.x === 3 && enemy.y === 2).toBe(false); // never on the potion
      attacked = events.some((e) => e.type === 'attack');
    }
    expect(attacked).toBe(true); // it reached the player by going around
  });
});

describe('enemy aggro through doors', () => {
  it('does not aggro on a player hidden behind a closed door', () => {
    // Player at x=2, enemy at x=8: the door at x=5 sits between them.
    const { state, enemy } = corridorState({ playerX: 2, enemyX: 8 });
    updateVisibility(state);
    enemyTurn(state, 2);
    expect(enemy.aggro).toBe(false);
    expect(enemy.x).toBe(8); // held position, never saw the player
  });

  it('aggroes when it shares open line of sight with the player', () => {
    // Both left of the door: clear sight.
    const { state, enemy } = corridorState({ playerX: 2, enemyX: 4 });
    updateVisibility(state);
    enemyTurn(state, 2);
    expect(enemy.aggro).toBe(true);
  });
});

describe('skeleton cadence (moveEvery 2)', () => {
  it('moves immediately on aggro, then only every other turn', () => {
    const { state, enemy } = corridorState({
      playerX: 1,
      enemyX: 4,
      enemyType: ENEMY_TYPES.skeleton,
    });
    updateVisibility(state);
    enemyTurn(state, 2);
    expect(enemy.x).toBe(3); // first step is immediate
    enemyTurn(state, 2);
    expect(enemy.x).toBe(3); // rests
    enemyTurn(state, 2);
    expect(enemy.x).toBe(2); // steps again, now adjacent
  });

  it('attacks every turn once adjacent — only movement is slowed', () => {
    const { state, enemy } = corridorState({
      playerX: 1,
      enemyX: 2,
      enemyType: ENEMY_TYPES.skeleton,
    });
    updateVisibility(state);
    for (let i = 0; i < 4; i++) {
      const events = enemyTurn(state, 2);
      expect(events.some((e) => e.type === 'attack')).toBe(true);
      expect(enemy.x).toBe(2);
    }
  });

  it('a goblin (moveEvery 1) still moves every turn', () => {
    const { state, enemy } = corridorState({
      playerX: 1,
      enemyX: 4,
      enemyType: ENEMY_TYPES.goblin,
    });
    updateVisibility(state);
    enemyTurn(state, 2);
    expect(enemy.x).toBe(3);
    enemyTurn(state, 2);
    expect(enemy.x).toBe(2);
  });

  it('skeletons hit as hard as goblins but are fragile (about half a goblin)', () => {
    const goblin = createEnemy(ENEMY_TYPES.goblin, 0, 0, 1);
    const skeleton = createEnemy(ENEMY_TYPES.skeleton, 0, 0, 1);
    expect(skeleton.attackDie).toBe(goblin.attackDie);
    expect(ENEMY_TYPES.skeleton.maxHp).toBe(3);
  });

  it('giving up the chase resets the cooldown so re-aggro steps immediately', () => {
    const { state, player, enemy } = corridorState({
      playerX: 3,
      enemyX: 4,
      enemyType: ENEMY_TYPES.skeleton,
    });
    updateVisibility(state);
    enemyTurn(state, 2); // adjacent: attacks, aggroed, lastSeen = (3,1)
    player.x = 9; // flee past the door, out of sight
    updateVisibility(state);
    enemyTurn(state, 2); // blind: steps onto the last-seen tile, cooldown spent
    expect(enemy.x).toBe(3);
    expect(enemy.moveCooldown).toBe(1);
    enemyTurn(state, 2); // trail runs cold: gives up
    expect(enemy.aggro).toBe(false);
    expect(enemy.moveCooldown).toBe(0);
  });
});

describe('enemy de-aggro on losing sight', () => {
  it('gives up once it reaches where the player was last seen and finds nothing', () => {
    // Enemy sees the player (both left of the door), then the player flees to the
    // far right, breaking line of sight behind the closed door.
    const { state, player, enemy } = corridorState({ playerX: 3, enemyX: 4 });
    updateVisibility(state);
    enemyTurn(state, 2);
    expect(enemy.aggro).toBe(true);
    expect(enemy.lastSeen).toEqual({ x: 3, y: 1 });

    player.x = 9; // flee past the door, out of the enemy's sight
    updateVisibility(state);

    let gaveUp = false;
    for (let i = 0; i < DEAGGRO_TURNS + 5 && !gaveUp; i++) {
      enemyTurn(state, 2);
      gaveUp = enemy.aggro === false;
    }
    expect(gaveUp).toBe(true);
    expect(enemy.lastSeen).toBe(null);
  });
});

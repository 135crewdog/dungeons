import { describe, it, expect } from 'vitest';
import { diagonalAllowed, isWalkable, isAdjacent, meleeReachable } from '../src/core/query.js';
import { enemyTurn } from '../src/systems/ai.js';
import { createEnemy } from '../src/entities/enemies.js';
import { canStep } from '../src/core/movement.js';
import { aStar } from '../src/systems/pathfinding.js';
import { TILE, ENEMY_TYPES } from '../src/core/constants.js';
import { createRng, chance } from '../src/core/rng.js';

describe('diagonalAllowed (shared no-corner-cutting rule)', () => {
  const open = () => true;
  it('always allows cardinal steps', () => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      expect(diagonalAllowed(() => false, 5, 5, dx, dy)).toBe(true);
    }
  });

  it('allows a diagonal only when both orthogonal neighbors are passable', () => {
    // Block the tile to the east of (5,5); a NE/SE step past it is illegal.
    const blockedEast = (x, y) => !(x === 6 && y === 5);
    expect(diagonalAllowed(blockedEast, 5, 5, 1, -1)).toBe(false); // NE squeezes past east wall
    expect(diagonalAllowed(blockedEast, 5, 5, 1, 1)).toBe(false); // SE too
    expect(diagonalAllowed(blockedEast, 5, 5, -1, -1)).toBe(true); // NW is clear
    expect(diagonalAllowed(open, 5, 5, 1, 1)).toBe(true); // all clear
  });
});

describe('movement and A* enforce the same corner-cut rule', () => {
  // Both now call diagonalAllowed; this fuzz guards against either re-inlining a
  // divergent copy in the future. Random 4x4 wall grids, every diagonal case.
  it('canStep and a one-tile A* agree on every diagonal on random grids', () => {
    const rng = createRng(31337);
    let checked = 0;
    for (let trial = 0; trial < 400; trial++) {
      const width = 4;
      const height = 4;
      const tiles = new Uint8Array(width * height);
      const map = { width, height, tiles };
      for (let i = 0; i < tiles.length; i++) tiles[i] = chance(rng, 0.6) ? TILE.FLOOR : TILE.WALL;
      const state = { map };
      const passable = (x, y) => isWalkable(map, x, y);
      for (const [dx, dy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        for (let y = 1; y < 3; y++) {
          for (let x = 1; x < 3; x++) {
            if (!isWalkable(map, x, y)) continue;
            const stepOk = canStep(state, { x, y }, dx, dy);
            const path = aStar(passable, { x, y }, { x: x + dx, y: y + dy }, width);
            const aStarDirect = path !== null && path.length === 2;
            expect(stepOk).toBe(aStarDirect);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

// A 6x5 map, all wall except: the enemy at (2,2), the player at (3,3) — kitty-
// corner to each other, with (3,2) and (2,3) solid wall between them — plus a
// corridor the long way round, (2,1)-(3,1)-(4,1)-(4,2)-(4,3), so the enemy has
// a legal route and "it can't reach" never means "it's stuck".
function cornerStandoffState() {
  const width = 6;
  const height = 5;
  const tiles = new Uint8Array(width * height); // all WALL
  const roomAt = new Int16Array(width * height).fill(-1);
  const map = { width, height, tiles, rooms: [], roomAt, stairsDown: null, stairsUp: null };
  for (const [x, y] of [
    [2, 2],
    [3, 3],
    [2, 1],
    [3, 1],
    [4, 1],
    [4, 2],
    [4, 3],
  ]) {
    tiles[y * width + x] = TILE.FLOOR;
  }
  const player = { id: 1, kind: 'player', x: 3, y: 3, hp: 20, maxHp: 20, attackDie: 8, glyph: '@' };
  const enemy = createEnemy(ENEMY_TYPES.goblin, 2, 2, 1);
  enemy.id = 2;
  enemy.aggro = true;
  const state = {
    rng: createRng(7),
    status: 'playing',
    turn: 0,
    log: [],
    items: [],
    map,
    // Fully lit: the enemy can see the player, so nothing but reach is in play.
    vis: {
      visible: new Uint8Array(width * height).fill(1),
      explored: new Uint8Array(width * height).fill(1),
    },
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

describe('melee reach obeys the corner rule for BOTH sides', () => {
  it('neither can swing diagonally past a wall corner', () => {
    const { state, player, enemy } = cornerStandoffState();
    // Chebyshev-adjacent — which is what the old rule tested, and why the enemy
    // used to get a free hit through the wall.
    expect(isAdjacent(enemy.x, enemy.y, player.x, player.y)).toBe(true);
    expect(meleeReachable(state.map, enemy.x, enemy.y, player.x, player.y)).toBe(false);
    expect(meleeReachable(state.map, player.x, player.y, enemy.x, enemy.y)).toBe(false);
    // The player's swing is a bump-move, and it was already refused here.
    expect(canStep(state, player, -1, -1)).toBe(false);
  });

  it('an aggroed enemy kitty-corner through a wall does not swing at all', () => {
    const { state, player } = cornerStandoffState();
    const before = player.hp;
    const events = enemyTurn(state, 2);
    // No swing, not merely a missed one — a miss would still be a free attack
    // roll the player could never answer.
    expect(events.some((e) => e.type === 'attack')).toBe(false);
    expect(player.hp).toBe(before);
  });

  it('it walks around the corner instead of standing there', () => {
    const { state, enemy } = cornerStandoffState();
    enemyTurn(state, 2);
    // The only legal neighbour is the corridor mouth at (2,1).
    expect([enemy.x, enemy.y]).toEqual([2, 1]);
  });

  it('still swings the moment it is genuinely adjacent', () => {
    const { state, player, enemy } = cornerStandoffState();
    enemy.x = 4; // (4,3) is cardinally adjacent to the player at (3,3)
    enemy.y = 3;
    expect(meleeReachable(state.map, enemy.x, enemy.y, player.x, player.y)).toBe(true);
    const events = enemyTurn(state, 2);
    expect(events.some((e) => e.type === 'attack')).toBe(true);
  });
});

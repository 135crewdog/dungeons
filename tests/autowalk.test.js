import { describe, it, expect } from 'vitest';
import { planPath, nextPathStep } from '../src/core/turnEngine.js';
import { createController } from '../src/input/controller.js';
import { createRng } from '../src/core/rng.js';
import { updateVisibility } from '../src/systems/visibility.js';
import { createEnemy } from '../src/entities/enemies.js';
import { ENEMY_TYPES, TILE } from '../src/core/constants.js';
import { idx } from '../src/core/query.js';

// A horizontal corridor (y=1, x=1..8) in a 10x3 wall field. `exploredTo` sets
// how far along the corridor is marked explored (default: all of it).
function corridorState(exploredTo = 8) {
  const width = 10;
  const height = 3;
  const tiles = new Uint8Array(width * height); // WALL
  const map = {
    width,
    height,
    tiles,
    rooms: [],
    roomAt: new Int16Array(width * height).fill(-1),
    stairs: null,
  };
  const explored = new Uint8Array(width * height);
  for (let x = 1; x <= 8; x++) {
    tiles[idx(map, x, 1)] = TILE.FLOOR;
    if (x <= exploredTo) explored[idx(map, x, 1)] = 1;
  }
  const player = { id: 1, kind: 'player', x: 1, y: 1, hp: 20, maxHp: 20, attackDie: 8, glyph: '@' };
  const state = {
    rng: createRng(1),
    status: 'playing',
    turn: 0,
    floor: 1,
    map,
    vis: { visible: new Uint8Array(width * height), explored },
    entities: { nextId: 2, playerId: 1, byId: new Map([[1, player]]) },
    items: [],
    path: null,
    prevVisibleEnemies: new Set(),
    log: [],
  };
  return { state, player };
}

describe('path planning (known-walkable A*)', () => {
  it('plans a path over explored tiles and yields correct steps', () => {
    const { state } = corridorState(8);
    expect(planPath(state, 8, 1)).toBe(true);
    expect(state.path.nodes[0]).toEqual({ x: 1, y: 1 });
    expect(state.path.nodes[state.path.nodes.length - 1]).toEqual({ x: 8, y: 1 });
    const step = nextPathStep(state);
    expect(step).toEqual({ dx: 1, dy: 0 });
  });

  it('refuses to plan onto an unexplored tile (no-op)', () => {
    const { state } = corridorState(5); // (8,1) is walkable but not yet explored
    expect(planPath(state, 8, 1)).toBe(false);
    expect(state.path).toBeNull();
  });

  it('refuses to route through unexplored tiles even to an explored goal', () => {
    const { state } = corridorState(8);
    // Un-explore a middle segment: the goal is explored but unreachable through fog.
    state.vis.explored[idx(state.map, 4, 1)] = 0;
    state.vis.explored[idx(state.map, 5, 1)] = 0;
    expect(planPath(state, 8, 1)).toBe(false);
  });
});

describe('auto-walk controller', () => {
  // Run scheduled steps immediately so a whole walk resolves within dispatch().
  const syncSchedule = (fn) => {
    fn();
    return () => {};
  };

  it('walks the player to the clicked destination', () => {
    const { state, player } = corridorState(8);
    let turns = 0;
    const controller = createController(state, () => (turns += 1), syncSchedule);
    controller.dispatch({ type: 'moveTo', x: 8, y: 1 });
    expect(player.x).toBe(8);
    expect(player.y).toBe(1);
    expect(turns).toBe(7); // 7 steps from x=1 to x=8
    expect(state.path).toBeNull(); // cleared on arrival
  });

  it('a clicked no-op (own tile / unexplored) does nothing', () => {
    const { state, player } = corridorState(8);
    const controller = createController(state, () => {}, syncSchedule);
    controller.dispatch({ type: 'moveTo', x: 1, y: 1 }); // own tile
    expect(player.x).toBe(1);
    expect(state.path).toBeNull();
  });

  it('a keyboard command cancels an in-progress walk', () => {
    const { state, player } = corridorState(8);
    // Only advance on demand so we can interleave a keyboard command.
    const pending = [];
    const manualSchedule = (fn) => {
      pending.push(fn);
      return () => {
        const i = pending.indexOf(fn);
        if (i >= 0) pending.splice(i, 1);
      };
    };
    const controller = createController(state, () => {}, manualSchedule);
    controller.dispatch({ type: 'moveTo', x: 8, y: 1 });
    expect(player.x).toBe(2); // took the first step, waiting to schedule more
    expect(pending).toHaveLength(1);
    controller.dispatch({ type: 'move', dx: 0, dy: 1 }); // new command cancels the walk
    expect(state.path).toBeNull();
  });
});

describe('auto-walk cancellation triggers', () => {
  // A longer corridor (y=1, x=1..12 in a 14x3 field) with real visibility, an
  // optional closed door, and an optional wall pocket at (pocketX, 0) for an
  // enemy that flanks the corridor. Everything is pre-explored (memory) so
  // click paths can be planned; `visible` comes from updateVisibility.
  function hallState({ playerX, doorX = null, pocketX = null } = {}) {
    const width = 14;
    const height = 3;
    const tiles = new Uint8Array(width * height); // WALL
    const map = {
      width,
      height,
      tiles,
      rooms: [],
      roomAt: new Int16Array(width * height).fill(-1),
      stairsDown: null,
      stairsUp: null,
    };
    for (let x = 1; x <= 12; x++) tiles[idx(map, x, 1)] = TILE.FLOOR;
    if (doorX !== null) tiles[idx(map, doorX, 1)] = TILE.DOOR;
    if (pocketX !== null) tiles[idx(map, pocketX, 0)] = TILE.FLOOR;
    const player = {
      id: 1,
      kind: 'player',
      x: playerX,
      y: 1,
      hp: 20,
      maxHp: 20,
      attackDie: 8,
      glyph: '@',
      strength: 0,
      skill: 0,
      armor: 0,
    };
    const state = {
      rng: createRng(1),
      status: 'playing',
      turn: 0,
      floor: 1,
      map,
      vis: { visible: new Uint8Array(width * height), explored: new Uint8Array(width * height) },
      entities: { nextId: 2, playerId: 1, byId: new Map([[1, player]]) },
      items: [],
      path: null,
      log: [],
    };
    state.vis.explored.fill(1); // the whole hall is remembered from a previous visit
    updateVisibility(state);
    return { state, player };
  }

  const syncSchedule = (fn) => {
    fn();
    return () => {};
  };

  it('cancels when a newly-visible enemy enters line of sight', () => {
    // The closed door at x=5 hides the enemy at x=9. Auto-walking right, the
    // step INTO the doorway reveals it — the walk must stop there.
    const { state, player } = hallState({ playerX: 1, doorX: 5 });
    const enemy = createEnemy(ENEMY_TYPES.goblin, 9, 1, 1);
    enemy.id = 2;
    state.entities.byId.set(2, enemy);
    updateVisibility(state);
    const controller = createController(state, () => {}, syncSchedule);
    controller.dispatch({ type: 'moveTo', x: 11, y: 1 });
    expect(player.x).toBe(5); // stopped in the doorway, well short of 11
    expect(state.path).toBeNull();
    expect(enemy.aggro).toBe(true); // sight is symmetric: it saw the player too
  });

  it('cancels when the player takes damage mid-walk', () => {
    // A pocket enemy flanks the corridor at (7,0). It is visible from the
    // start (so the new-enemy check can never fire) and its movement is
    // frozen, but adjacency still makes it attack: with this seed its first
    // swing lands and the walk stops on the damage check.
    const { state, player } = hallState({ playerX: 5, pocketX: 7 });
    const enemy = createEnemy(ENEMY_TYPES.goblin, 7, 0, 1);
    enemy.id = 2;
    enemy.moveCooldown = 99; // hold position; attacking is never gated
    state.entities.byId.set(2, enemy);
    updateVisibility(state);
    expect(state.vis.visible[idx(state.map, 7, 0)]).toBe(1); // in the baseline
    const controller = createController(state, () => {}, syncSchedule);
    controller.dispatch({ type: 'moveTo', x: 12, y: 1 });
    expect(player.hp).toBeLessThan(20); // the swing landed (deterministic seed)
    expect(player.x).toBeLessThan(12); // and the walk stopped early
    expect(state.path).toBeNull();
  });

  it('an enemy already in view when the walk starts does not cancel it', () => {
    // Same pocket enemy, but behind the player and out of reach: visible at
    // plan time (baseline), never adjacent, never newly sighted — the walk
    // must run to completion.
    const { state, player } = hallState({ playerX: 5, pocketX: 2 });
    const enemy = createEnemy(ENEMY_TYPES.goblin, 2, 0, 1);
    enemy.id = 2;
    enemy.moveCooldown = 99;
    state.entities.byId.set(2, enemy);
    updateVisibility(state);
    const controller = createController(state, () => {}, syncSchedule);
    controller.dispatch({ type: 'moveTo', x: 12, y: 1 });
    expect(player.x).toBe(12); // arrived
    expect(state.path).toBeNull(); // cleared on arrival
  });
});

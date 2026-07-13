import { describe, it, expect } from 'vitest';
import { planPath, nextPathStep } from '../src/core/turnEngine.js';
import { createController } from '../src/input/controller.js';
import { createRng } from '../src/core/rng.js';
import { TILE } from '../src/core/constants.js';
import { idx } from '../src/core/query.js';

// A horizontal corridor (y=1, x=1..8) in a 10x3 wall field. `exploredTo` sets
// how far along the corridor is marked explored (default: all of it).
function corridorState(exploredTo = 8) {
  const width = 10;
  const height = 3;
  const tiles = new Uint8Array(width * height); // WALL
  const map = { width, height, tiles, rooms: [], roomAt: new Int16Array(width * height).fill(-1), stairs: null };
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
    const { state, player } = corridorState(8);
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

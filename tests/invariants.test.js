// Broad-seed invariants: properties that must hold for EVERY run, checked
// across many seeds and floors rather than the handful a scenario test picks.
//
// The unit suites assert specific outcomes; these assert the rules those
// outcomes are supposed to obey. They are the guard against a refactor that
// keeps every example passing while breaking the general case — and they are
// cheap, because the simulation runs headless.

import { describe, it, expect } from 'vitest';
import { createGame, descend, ascend } from '../src/core/gameState.js';
import { processCommand } from '../src/core/turnEngine.js';
import { getPlayer, isWalkable, tileAt } from '../src/core/query.js';
import { TILE, DIRS8 } from '../src/core/constants.js';

const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i);
const DEEP_SEEDS = Array.from({ length: 8 }, (_, i) => 500 + i);

// Every problem found on a floor, as readable strings — an empty array is the
// assertion, and a failure names the seed, floor, and tile.
function floorProblems(state, label) {
  const problems = [];
  const map = state.map;

  const seen = new Map();
  for (const e of state.entities.byId.values()) {
    const key = `${e.x},${e.y}`;
    if (seen.has(key)) problems.push(`${label}: ${e.kind} shares ${key} with ${seen.get(key)}`);
    seen.set(key, e.kind);
    if (e.x < 0 || e.y < 0 || e.x >= map.width || e.y >= map.height) {
      problems.push(`${label}: ${e.kind} out of bounds at ${key}`);
    } else if (!isWalkable(map, e.x, e.y)) {
      problems.push(`${label}: ${e.kind} inside a wall at ${key}`);
    }
  }

  const itemSeen = new Map();
  for (const it of state.items) {
    const key = `${it.x},${it.y}`;
    if (itemSeen.has(key)) {
      problems.push(`${label}: ${it.type} stacked on ${itemSeen.get(key)} at ${key}`);
    }
    itemSeen.set(key, it.type);
    const tile = tileAt(map, it.x, it.y);
    // An item on a staircase would be unreachable in practice: stepping onto
    // the stairs ends the turn before pickups resolve.
    if (tile === TILE.STAIRS_DOWN || tile === TILE.STAIRS_UP) {
      problems.push(`${label}: ${it.type} on a staircase at ${key}`);
    }
    if (tile === TILE.WALL) problems.push(`${label}: ${it.type} inside a wall at ${key}`);
  }
  return problems;
}

describe('generation invariants', () => {
  it('never places two entities, or two items, on one tile', () => {
    const problems = [];
    for (const seed of SEEDS) {
      const state = createGame(seed);
      problems.push(...floorProblems(state, `seed ${seed} floor 1`));
    }
    expect(problems).toEqual([]);
  });

  it('holds through a descent to floor 12, boss floors included', () => {
    const problems = [];
    for (const seed of DEEP_SEEDS) {
      const state = createGame(seed);
      for (let floor = 2; floor <= 12; floor++) {
        descend(state);
        problems.push(...floorProblems(state, `seed ${seed} floor ${floor}`));
      }
    }
    expect(problems).toEqual([]);
  });

  it('spawns every floor with a player on a walkable tile and stairs down', () => {
    for (const seed of SEEDS) {
      const state = createGame(seed);
      const p = getPlayer(state);
      expect(isWalkable(state.map, p.x, p.y), `seed ${seed}`).toBe(true);
      expect(state.map.stairsDown, `seed ${seed}`).toBeTruthy();
    }
  });

  it('never makes a border cell walkable, so the map is sealed by a wall rim', () => {
    // Load-bearing beyond "you cannot walk off the edge": renderer/camera.js's
    // pickClickTile snaps a dead click DOWN onto the walkable tile below it, and
    // an out-of-bounds click one pixel above the map floors to row -1, which is
    // indistinguishable from a wall to its predicate. The snap can only reach
    // into the map from outside if row 0 is walkable — this is what guarantees
    // it never is. If the generator ever stops reserving the rim, the click
    // helper needs an explicit bounds check.
    const problems = [];
    for (const seed of SEEDS) {
      const state = createGame(seed);
      const m = state.map;
      for (let x = 0; x < m.width; x++) {
        if (isWalkable(m, x, 0)) problems.push(`seed ${seed}: (${x},0) walkable`);
        if (isWalkable(m, x, m.height - 1)) problems.push(`seed ${seed}: (${x},${m.height - 1})`);
      }
      for (let y = 0; y < m.height; y++) {
        if (isWalkable(m, 0, y)) problems.push(`seed ${seed}: (0,${y}) walkable`);
        if (isWalkable(m, m.width - 1, y)) problems.push(`seed ${seed}: (${m.width - 1},${y})`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('floor transition invariants', () => {
  it('never leaves two entities sharing the arrival tile, down or up', () => {
    // The arrival stair can be occupied by a de-aggroed enemy; the player is
    // attached to that exact tile, so the squatter has to be moved first.
    const problems = [];
    for (const seed of DEEP_SEEDS) {
      const state = createGame(seed);
      for (let floor = 2; floor <= 8; floor++) {
        descend(state);
        problems.push(...floorProblems(state, `seed ${seed} down->${floor}`));
      }
      for (let floor = 7; floor >= 1; floor--) {
        ascend(state);
        problems.push(...floorProblems(state, `seed ${seed} up->${floor}`));
      }
    }
    expect(problems).toEqual([]);
  });

  it('clears a squatter off the arrival stair, on real generated floors', () => {
    // The natural case is rare — a de-aggroed enemy has to be standing on the
    // exact tile you come back to — so the sweep above almost never hits it.
    // Plant the squatter instead: move an enemy onto the tile the player will
    // land on, then make the transition. Without ensureArrivalClear doing its
    // job, the player is attached on top of it.
    const problems = [];
    let exercised = 0;
    for (const seed of SEEDS) {
      const state = createGame(seed);
      descend(state);
      const cached = state.floors.get(1);
      const arrival = cached.map.stairsDown;
      const squatter = [...cached.byId.values()].find((e) => e.kind !== 'player');
      if (!squatter || !arrival) continue;
      squatter.x = arrival.x;
      squatter.y = arrival.y;

      ascend(state); // lands the player on floor 1's down-stairs
      exercised += 1;

      const p = getPlayer(state);
      expect(`${p.x},${p.y}`, `seed ${seed}`).toBe(`${arrival.x},${arrival.y}`);
      problems.push(...floorProblems(state, `seed ${seed} squatted arrival`));
    }
    expect(exercised, 'no seed exercised the squatter path').toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });

  it('restores a revisited floor exactly as it was left', () => {
    for (const seed of DEEP_SEEDS) {
      const state = createGame(seed);
      descend(state);
      const before = {
        tiles: Array.from(state.map.tiles),
        items: state.items.map((i) => `${i.id}@${i.x},${i.y}`).sort(),
        entities: [...state.entities.byId.keys()].filter((k) => k !== 1).sort(),
      };
      ascend(state);
      descend(state);
      expect(Array.from(state.map.tiles), `seed ${seed}`).toEqual(before.tiles);
      expect(state.items.map((i) => `${i.id}@${i.x},${i.y}`).sort()).toEqual(before.items);
      expect([...state.entities.byId.keys()].filter((k) => k !== 1).sort()).toEqual(
        before.entities,
      );
    }
  });
});

describe('turn invariants', () => {
  // Walk each seed with a fixed, deterministic command sequence. Not a bot —
  // just enough motion to exercise moves, bumps, and blocked steps.
  const WALK = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  it('consumes exactly one turn per successful command, and none per refusal', () => {
    for (const seed of SEEDS) {
      const state = createGame(seed);
      for (let i = 0; i < 40 && state.status === 'playing'; i++) {
        const before = state.turn;
        const dir = WALK[i % WALK.length];
        const events = processCommand(state, { type: 'move', ...dir });
        const consumed = state.turn - before;
        if (events.length === 0) {
          expect(consumed, `seed ${seed} step ${i}: refused command`).toBe(0);
        } else {
          expect(consumed, `seed ${seed} step ${i}: accepted command`).toBe(1);
        }
      }
    }
  });

  it('leaves state and the RNG untouched when a command is refused', () => {
    for (const seed of SEEDS) {
      const state = createGame(seed);
      const p = getPlayer(state);
      // Find a direction that is blocked by a wall from the spawn tile.
      const blocked = DIRS8.find((d) => !isWalkable(state.map, p.x + d.dx, p.y + d.dy));
      if (!blocked) continue;
      // `s` is the mulberry32 cursor (see core/rng.js) — a refused command must
      // not have drawn from it. Read the real field name: an `rng.state` typo
      // here would make this assertion pass vacuously forever.
      expect(typeof state.rng.s, 'RNG cursor field').toBe('number');
      const before = {
        turn: state.turn,
        rng: state.rng.s,
        pos: `${p.x},${p.y}`,
        log: state.log.length,
        items: state.items.length,
      };
      const events = processCommand(state, { type: 'move', ...blocked });
      expect(events, `seed ${seed}`).toEqual([]);
      expect(state.turn).toBe(before.turn);
      expect(`${p.x},${p.y}`).toBe(before.pos);
      expect(state.log.length).toBe(before.log);
      expect(state.items.length).toBe(before.items);
      expect(state.rng.s, `seed ${seed}: RNG advanced on a refused command`).toBe(before.rng);
    }
  });

  it('is fully deterministic: same seed + same commands ⇒ same state', () => {
    // The promise the whole project rests on, asserted directly rather than
    // inferred from the e2e fixtures.
    const play = (seed) => {
      const state = createGame(seed);
      for (let i = 0; i < 60 && state.status === 'playing'; i++) {
        processCommand(state, { type: 'move', ...WALK[i % WALK.length] });
      }
      const p = getPlayer(state);
      return {
        turn: state.turn,
        floor: state.floor,
        status: state.status,
        player: { x: p.x, y: p.y, hp: p.hp },
        entities: [...state.entities.byId.values()]
          .map((e) => `${e.id}:${e.kind}@${e.x},${e.y}:${e.hp}`)
          .sort(),
        items: state.items.map((i) => `${i.id}:${i.type}@${i.x},${i.y}`).sort(),
        log: state.log.map((l) => `${l.turn}:${l.type}`),
      };
    };
    for (const seed of SEEDS.slice(0, 12)) {
      expect(play(seed), `seed ${seed}`).toEqual(play(seed));
    }
  });
});

describe('performance budgets', () => {
  // Deliberately loose: this catches an order-of-magnitude regression (an
  // accidental O(n²) in generation, a per-turn full-map rebuild), not the
  // few-milliseconds noise of a shared CI runner.
  it('generates a floor well inside budget', () => {
    const start = performance.now();
    for (const seed of SEEDS) createGame(seed);
    const perFloor = (performance.now() - start) / SEEDS.length;
    expect(perFloor, `${perFloor.toFixed(1)}ms per floor`).toBeLessThan(150);
  });

  it('resolves a crowded deep turn well inside budget', () => {
    const state = createGame(1234);
    for (let i = 0; i < 11; i++) descend(state); // floor 12: most enemies
    const start = performance.now();
    let turns = 0;
    for (let i = 0; i < 30 && state.status === 'playing'; i++) {
      processCommand(state, { type: 'move', dx: i % 2 ? 1 : -1, dy: 0 });
      turns += 1;
    }
    const perTurn = (performance.now() - start) / Math.max(1, turns);
    expect(perTurn, `${perTurn.toFixed(2)}ms per turn`).toBeLessThan(50);
  });
});

// Headless game runner for the balance simulator. Drives the real simulation
// (createGame + processCommand) with a bot policy and records what a balance
// pass needs: how deep runs get, where and how they die, and what the player
// had banked at each descent. No combat math is reimplemented here — if the
// game changes, the simulator follows automatically.

import { createGame } from '../../src/core/gameState.js';
import { processCommand } from '../../src/core/turnEngine.js';
import { getPlayer } from '../../src/core/query.js';
import { EV } from '../../src/core/events.js';
import { PLAYER_ID, BOSS_FLOOR_INTERVAL } from '../../src/core/constants.js';
import { POLICIES } from './policies.js';

// What killed the player, from the turn's event list: the death event follows
// its cause, so the nearest preceding trap pickup or landed hit is the killer.
function deathCauseFrom(events, state) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === EV.PICKUP && ev.effect === 'trap') return 'trap';
    if (ev.type === EV.ATTACK && ev.targetId === PLAYER_ID && ev.hit) {
      return state.entities.byId.get(ev.attackerId)?.kind ?? 'enemy';
    }
  }
  return 'unknown';
}

// Play one seeded game to death, past maxFloor, or a stall. A run "clears"
// floor N by descending from it, so clearing maxFloor ends the run alive on
// floor maxFloor + 1.
export function runGame(seed, policyName, { maxFloor = 12, floorTurnCap = 2000 } = {}) {
  const policy = POLICIES[policyName];
  if (!policy) throw new Error(`unknown policy: ${policyName}`);

  const state = createGame(seed);
  const descents = [];
  let turns = 0;
  let floorTurns = 0;
  let noops = 0;
  let stalled = false;
  let deathCause = null;

  while (state.status === 'playing' && state.floor <= maxFloor) {
    if (++floorTurns > floorTurnCap) {
      stalled = true;
      break;
    }
    const step = policy.decide(state);
    if (!step) {
      stalled = true;
      break;
    }
    const events = processCommand(state, { type: 'move', dx: step.dx, dy: step.dy });
    if (events.length === 0) {
      // The engine refused the command (invalid move). The policy should never
      // produce one; a few in a row means the bot is wedged, not the game.
      if (++noops > 20) {
        stalled = true;
        break;
      }
      continue;
    }
    noops = 0;
    turns++;

    for (const ev of events) {
      if (ev.type === EV.DESCEND) {
        const p = getPlayer(state);
        descents.push({
          floor: ev.floor - 1, // the floor just cleared
          turn: turns,
          hp: p.hp,
          maxHp: p.maxHp,
          strength: p.strength ?? 0,
          armor: p.armor ?? 0,
        });
        floorTurns = 0;
      } else if (ev.type === EV.DEATH && ev.id === PLAYER_ID) {
        deathCause = deathCauseFrom(events, state);
      }
    }
  }

  const dead = state.status === 'dead';
  return {
    seed,
    policy: policyName,
    cleared: !dead && !stalled && state.floor > maxFloor,
    deathFloor: dead ? state.floor : null,
    deathCause: dead ? deathCause : null,
    maxFloorReached: state.floor,
    turns,
    stalled,
    descents,
  };
}

export function runBatch(
  policyName,
  { runs = 200, baseSeed = 1000, maxFloor = 12, floorTurnCap } = {},
) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    results.push(runGame(baseSeed + i, policyName, { maxFloor, floorTurnCap }));
  }
  return {
    policy: policyName,
    runs,
    baseSeed,
    maxFloor,
    summary: summarize(results, maxFloor),
    results,
  };
}

export function summarize(results, maxFloor) {
  const runs = results.length;
  const deaths = results.filter((r) => r.deathFloor !== null);

  const reachedByFloor = {};
  for (let f = 1; f <= maxFloor + 1; f++) {
    reachedByFloor[f] = results.filter((r) => r.maxFloorReached >= f).length / runs;
  }

  const deathsByFloor = {};
  const deathCauses = {};
  for (const r of deaths) {
    deathsByFloor[r.deathFloor] = (deathsByFloor[r.deathFloor] ?? 0) + 1;
    deathCauses[r.deathCause] = (deathCauses[r.deathCause] ?? 0) + 1;
  }

  const deathFloors = deaths.map((r) => r.deathFloor).sort((a, b) => a - b);
  const medianDeathFloor = deathFloors.length
    ? deathFloors[Math.floor(deathFloors.length / 2)]
    : null;

  // Player snapshot at each descent, averaged per cleared floor.
  const descentByFloor = {};
  for (const r of results) {
    for (const d of r.descents) {
      (descentByFloor[d.floor] ??= []).push(d);
    }
  }
  const avgAtDescent = {};
  for (const [floor, list] of Object.entries(descentByFloor)) {
    const n = list.length;
    avgAtDescent[floor] = {
      n,
      hp: sum(list, 'hp') / n,
      maxHp: sum(list, 'maxHp') / n,
      strength: sum(list, 'strength') / n,
      armor: sum(list, 'armor') / n,
    };
  }

  const bossFloorDeaths = deaths.filter((r) => r.deathFloor % BOSS_FLOOR_INTERVAL === 0).length;

  return {
    runs,
    cleared: results.filter((r) => r.cleared).length / runs,
    reachedByFloor,
    deathsByFloor,
    deathCauses,
    medianDeathFloor,
    bossFloorDeathShare: deaths.length ? bossFloorDeaths / deaths.length : 0,
    avgAtDescent,
    stalled: results.filter((r) => r.stalled).length,
    avgTurns: sum(results, 'turns') / runs,
  };
}

function sum(list, key) {
  return list.reduce((acc, item) => acc + item[key], 0);
}

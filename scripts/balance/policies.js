// Bot policies for the headless balance simulator. Each policy exposes
// decide(state) -> { dx, dy } | null, recomputed fresh every turn from the
// same information a human player has: explored/visible tiles, on-screen
// enemies, and known item locations. Null means the bot has nothing left to
// do — the runner records that as a stall (a bot bug, never a balance signal).
//
// The thorough bot plays the way a competent careful player does: it breaks
// off to a known potion when nearly dead, falls back when outnumbered in the
// open so pursuers arrive strung out (enemies path around each other, so a
// retreat through a corridor funnels them), heals up before walking into a
// boss lair, and otherwise clears every fight, chest, and tile before taking
// the stairs. The rusher is deliberately reckless — that archetype's death
// rate is itself a balance signal.
//
// Navigation is a breadth-first search over known-walkable tiles with the
// same no-corner-cutting rule as the game's movement, expanding neighbors in
// DIRS8 order so the chosen step is deterministic. Stair tiles change floors
// the moment they are stepped on, so BFS treats them as blocked unless the
// stair itself is the goal. Enemy-occupied tiles are passable on purpose:
// stepping into one is a bump-attack, which is exactly how a player fights
// through a blocker.

import { TILE, DIRS8 } from '../../src/core/constants.js';
import {
  getPlayer,
  enemiesSorted,
  isKnownWalkable,
  isExplored,
  isVisible,
  isWalkable,
  inBounds,
  tileAt,
  chebyshev,
  entityAt,
} from '../../src/core/query.js';

// First step of the shortest known path from the player to the nearest tile
// satisfying isGoal, as { dx, dy, dist } — or null if no goal is reachable.
// The player's own tile is never returned as a goal.
function bfsFind(state, isGoal) {
  const map = state.map;
  const w = map.width;
  const player = getPlayer(state);
  const startId = player.y * w + player.x;

  const passable = (x, y) => {
    if (!isKnownWalkable(state, x, y)) return false;
    const t = tileAt(map, x, y);
    if (t === TILE.STAIRS_DOWN || t === TILE.STAIRS_UP) return isGoal(x, y);
    return true;
  };

  const prev = new Map([[startId, -1]]);
  const queue = [{ x: player.x, y: player.y }];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const curId = cur.y * w + cur.x;
    for (const { dx, dy } of DIRS8) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const nid = ny * w + nx;
      if (prev.has(nid)) continue;
      if (!passable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!passable(cur.x + dx, cur.y) || !passable(cur.x, cur.y + dy)) continue;
      }
      prev.set(nid, curId);
      if (isGoal(nx, ny)) return firstStepOf(prev, nid, startId, w);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

function firstStepOf(prev, goalId, startId, w) {
  let dist = 1;
  let id = goalId;
  while (prev.get(id) !== startId) {
    id = prev.get(id);
    dist++;
  }
  const sx = startId % w;
  const sy = Math.floor(startId / w);
  return { dx: (id % w) - sx, dy: Math.floor(id / w) - sy, dist };
}

// The adjacent enemy to bump this turn: lowest HP first (finish kills), ties
// to the lowest id. Skips diagonals the movement rules would refuse (both
// orthogonals must be walkable — same check as canStep).
function adjacentTarget(state) {
  const player = getPlayer(state);
  let best = null;
  for (const e of enemiesSorted(state)) {
    if (chebyshev(player.x, player.y, e.x, e.y) !== 1) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    if (dx !== 0 && dy !== 0) {
      if (!isWalkable(state.map, player.x + dx, player.y)) continue;
      if (!isWalkable(state.map, player.x, player.y + dy)) continue;
    }
    if (!best || e.hp < best.enemy.hp) best = { enemy: e, dx, dy };
  }
  return best;
}

// A step that keeps every threat at least as far away as it is now, preferring
// door tiles (they funnel pursuers into single file), then the step that
// maximizes the nearest threat's distance (ties resolve in DIRS8 order).
// Null when cornered — the caller should stand and fight instead.
function retreatStep(state, threats) {
  const player = getPlayer(state);
  const minDist = (x, y) => Math.min(...threats.map((e) => chebyshev(x, y, e.x, e.y)));
  const current = minDist(player.x, player.y);
  let best = null;
  for (const { dx, dy } of DIRS8) {
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (!isKnownWalkable(state, nx, ny)) continue;
    const t = tileAt(state.map, nx, ny);
    if (t === TILE.STAIRS_DOWN || t === TILE.STAIRS_UP) continue;
    if (entityAt(state, nx, ny)) continue;
    if (dx !== 0 && dy !== 0) {
      if (!isWalkable(state.map, player.x + dx, player.y)) continue;
      if (!isWalkable(state.map, player.x, player.y + dy)) continue;
    }
    const d = minDist(nx, ny);
    // Never step closer, and always end out of melee range — a "retreat" that
    // stays adjacent hands the pursuer free hits while we don't swing back.
    if (d < current || d < 2) continue;
    const door = t === TILE.DOOR ? 1 : 0;
    if (!best || door > best.door || (door === best.door && d > best.d)) {
      best = { dx, dy, d, door };
    }
  }
  return best ? { dx: best.dx, dy: best.dy } : null;
}

// A frontier tile: known-walkable, not a stair, with at least one in-bounds
// unexplored neighbor. Standing on one reveals more map.
function isFrontier(state, x, y) {
  const t = tileAt(state.map, x, y);
  if (t === TILE.STAIRS_DOWN || t === TILE.STAIRS_UP) return false;
  for (const { dx, dy } of DIRS8) {
    const nx = x + dx;
    const ny = y + dy;
    if (inBounds(state.map, nx, ny) && !isExplored(state, nx, ny)) return true;
  }
  return false;
}

function stepToStairsDown(state) {
  const sd = state.map.stairsDown;
  if (!sd || !isExplored(state, sd.x, sd.y)) return null;
  return bfsFind(state, (x, y) => x === sd.x && y === sd.y);
}

function tileSet(items) {
  return new Set(items.map(({ x, y }) => `${x},${y}`));
}

function inSet(set) {
  return (x, y) => set.has(`${x},${y}`);
}

// HP at or below this is an emergency: two average hits could end the run.
function desperate(player) {
  return player.hp <= Math.max(4, Math.round(player.maxHp * 0.35));
}

function knownPotions(state) {
  return tileSet(state.items.filter((it) => it.type === 'potion' && isExplored(state, it.x, it.y)));
}

// Thorough: clears each floor completely before descending — kill everything
// it sees, open every chest, drink potions without overhealing, explore every
// reachable tile, sweep leftover potions if hurt, then take the stairs.
export const thorough = {
  name: 'thorough',
  decide(state) {
    const player = getPlayer(state);
    const threats = enemiesSorted(state).filter(
      (e) => isVisible(state, e.x, e.y) || chebyshev(player.x, player.y, e.x, e.y) === 1,
    );
    const potions = knownPotions(state);

    const healRun = (maxDist) => {
      if (!potions.size) return null;
      const run = bfsFind(state, inSet(potions));
      return run && run.dist <= maxDist ? run : null;
    };

    if (threats.length) {
      // Emergency: break off and run for a nearby known potion, even mid-fight.
      if (desperate(player)) {
        const run = healRun(8);
        if (run) return run;
      }
      // Never trade with a boss while wounded if a heal is still on the map —
      // kite it (same movement speed: it can't land a hit on a moving target).
      if (threats.some((e) => e.kind === 'boss') && player.hp < player.maxHp - 4) {
        const run = healRun(Infinity);
        if (run) return run;
      }
      const frontierStep = () => bfsFind(state, (x, y) => isFrontier(state, x, y));

      // Once engaged, finish the fight — swapping hits beats eating free ones.
      // Exception: a boss is never worth tanking below near-full HP while any
      // alternative (a heal, more floor to sweep) remains — back off instead.
      const adj = adjacentTarget(state);
      if (adj) {
        const avoidBoss =
          adj.enemy.kind === 'boss' &&
          player.hp < player.maxHp - 4 &&
          (potions.size > 0 || frontierStep());
        if (!avoidBoss) return { dx: adj.dx, dy: adj.dy };
        const away = retreatStep(state, [adj.enemy]);
        if (away) return away;
        return { dx: adj.dx, dy: adj.dy }; // cornered: fight
      }
      // Outnumbered with nobody engaged yet: fall back (same-speed pursuers
      // can't hit a moving target) so the group strings out, biasing toward
      // doorways where the corner-cut rule funnels attackers one at a time.
      const near = threats.filter((e) => chebyshev(player.x, player.y, e.x, e.y) <= 4);
      if (near.length >= 2) {
        const fallback = retreatStep(state, near);
        if (fallback) return fallback;
      }
      // Weak with nobody engaged: top up first, or at least don't start
      // anything — explore away and let the door funnel handle pursuers.
      if (player.hp < player.maxHp * 0.5) {
        const run = healRun(Infinity);
        if (run) return run;
        // No heals and a boss on the prowl: skip its chest, sprint for the
        // stairs (they're in its room — eat a swing or two, not the fight).
        if (threats.some((e) => e.kind === 'boss')) {
          const dash = stepToStairsDown(state);
          if (dash) return dash;
        }
      } else {
        const visible = threats.filter((e) => isVisible(state, e.x, e.y));
        let hunt = visible;
        if (
          visible.some((e) => e.kind === 'boss') &&
          (player.hp < player.maxHp - 4 || frontierStep())
        ) {
          // Leave the boss for last: sweep the rest of the floor (and its
          // chests) first — it chases, but it can never catch a moving player.
          hunt = visible.filter((e) => e.kind !== 'boss');
        }
        if (hunt.length) {
          const step = bfsFind(state, inSet(tileSet(hunt)));
          if (step) return step;
        }
      }
    }

    const wanted = tileSet(
      state.items.filter(
        (it) =>
          isExplored(state, it.x, it.y) &&
          (it.type === 'chest' || (it.type === 'potion' && player.hp <= player.maxHp - it.heal)),
      ),
    );
    if (wanted.size) {
      const step = bfsFind(state, inSet(wanted));
      if (step) return step;
    }

    const step = bfsFind(state, (x, y) => isFrontier(state, x, y));
    if (step) return step;

    if (player.hp < player.maxHp && potions.size) {
      const sweep = bfsFind(state, inSet(potions));
      if (sweep) return sweep;
    }

    return stepToStairsDown(state);
  },
};

// Stair-rusher: beelines for the down-stairs as soon as it knows where they
// are, exploring only as much as needed to find them. Never detours for items
// or fights beyond bumping through whatever blocks the path — except a
// desperate grab at a potion that is practically on the way.
export const rusher = {
  name: 'rusher',
  decide(state) {
    const player = getPlayer(state);
    if (desperate(player)) {
      const potions = knownPotions(state);
      if (potions.size) {
        const run = bfsFind(state, inSet(potions));
        if (run && run.dist <= 4) return run;
      }
    }

    const toStairs = stepToStairsDown(state);
    if (toStairs) return toStairs;

    const step = bfsFind(state, (x, y) => isFrontier(state, x, y));
    if (step) return step;

    // Boxed in with nowhere to go: fight whoever is adjacent.
    const adj = adjacentTarget(state);
    if (adj) return { dx: adj.dx, dy: adj.dy };
    return null;
  },
};

export const POLICIES = { thorough, rusher };

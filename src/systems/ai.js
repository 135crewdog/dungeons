// Enemy behaviour. An enemy aggroes the moment it can see the player (symmetric
// FOV means "the player can see it" ⇔ "it can see the player"). While it has
// line of sight it attacks if adjacent, else steps one A* tile toward the
// player. When it loses sight it heads for the last tile it saw the player on,
// and gives up (holds position, re-aggros only on a fresh sighting) once it
// gets there empty-handed or after DEAGGRO_TURNS turns blind. Un-aggroed
// enemies hold position.

import { getPlayer, isVisible, isAdjacent, isWalkable } from '../core/query.js';
import { DEAGGRO_TURNS } from '../core/constants.js';
import { tryMove } from '../core/movement.js';
import { resolveAttack } from './combat.js';
import { aStar } from './pathfinding.js';

// Tile-occupancy snapshot for the enemy phase: a Set of packed y*width+x keys,
// one per entity. The turn engine builds it ONCE per turn and hands the same
// set to every enemy, and moveIfReady keeps it live as enemies step (so a later
// enemy still routes around one that already moved this turn). This replaces a
// linear entityAt scan inside the A* inner loop with an O(1) lookup — same
// "route around other entities" behavior, far less work when the floor is busy.
export function buildOccupancy(state) {
  const w = state.map.width;
  const set = new Set();
  for (const e of state.entities.byId.values()) set.add(e.y * w + e.x);
  return set;
}

// Run one enemy's turn, returning the events it produced. `occupied` is the
// shared per-turn occupancy set; it defaults to a freshly built one so a
// stand-alone call (e.g. a unit test) still behaves identically.
export function enemyTurn(state, enemyId, occupied = buildOccupancy(state)) {
  const events = [];
  const enemy = state.entities.byId.get(enemyId);
  if (!enemy) return events;
  const player = getPlayer(state);
  if (!player) return events;

  const canSee = isVisible(state, enemy.x, enemy.y);
  if (canSee) {
    enemy.aggro = true;
    enemy.lastSeen = { x: player.x, y: player.y };
    enemy.lostSightTurns = 0;
  }
  if (!enemy.aggro) return events;

  // An aggroed enemy in melee range strikes, sight or not.
  if (isAdjacent(enemy.x, enemy.y, player.x, player.y)) {
    return resolveAttack(state, enemy.id, player.id);
  }

  // In sight: close in on the player directly (lastSeen == player right now).
  if (canSee) {
    moveIfReady(state, enemy, enemy.lastSeen, events, occupied);
    return events;
  }

  // Lost sight: give up once the trail runs cold (reached the last-seen tile
  // with no player there) or after too many blind turns; otherwise keep heading
  // for where the player was last seen.
  enemy.lostSightTurns++;
  const atLastSeen = enemy.lastSeen && enemy.x === enemy.lastSeen.x && enemy.y === enemy.lastSeen.y;
  if (!enemy.lastSeen || atLastSeen || enemy.lostSightTurns > DEAGGRO_TURNS) {
    enemy.aggro = false;
    enemy.lastSeen = null;
    enemy.lostSightTurns = 0;
    enemy.moveCooldown = 0; // a fresh re-aggro gets an immediate first step
    return events;
  }

  moveIfReady(state, enemy, enemy.lastSeen, events, occupied);
  return events;
}

// Movement gate for slow enemies: a moveEvery-N enemy steps once, then rests
// N-1 turns. The cooldown ticks only on turns the enemy is trying to move —
// attacking never consumes or advances it — and is spent only on a successful
// step, so a blocked enemy keeps its charge and retries next turn.
function moveIfReady(state, enemy, goal, events, occupied) {
  if ((enemy.moveCooldown ?? 0) > 0) {
    enemy.moveCooldown--;
    return;
  }
  const step = stepToward(state, enemy, goal, occupied);
  if (!step) return;
  const w = state.map.width;
  const fromKey = enemy.y * w + enemy.x;
  if (tryMove(state, enemy, step.dx, step.dy, events)) {
    enemy.moveCooldown = (enemy.moveEvery ?? 1) - 1;
    // Keep the shared occupancy live: if the enemy actually stepped (a bump-
    // attack leaves it in place), it vacated fromKey for its new tile.
    const toKey = enemy.y * w + enemy.x;
    if (toKey !== fromKey) {
      occupied.delete(fromKey);
      occupied.add(toKey);
    }
  }
}

// First step of an A* path from the enemy to a goal tile. Enemies see the whole
// map (they are not fogged). Other entities (via `occupied`) block the path; the
// goal tile itself is always allowed (it may hold the player). Returns
// { dx, dy } or null.
function stepToward(state, enemy, goal, occupied) {
  if (!goal) return null;
  const map = state.map;
  const w = map.width;
  const passable = (x, y) => {
    if (!isWalkable(map, x, y)) return false;
    if (x === goal.x && y === goal.y) return true; // the goal tile is allowed
    return !occupied.has(y * w + x); // route around other entities
  };
  const path = aStar(passable, { x: enemy.x, y: enemy.y }, goal, map.width);
  if (!path || path.length < 2) return null;
  const next = path[1];
  return { dx: next.x - enemy.x, dy: next.y - enemy.y };
}

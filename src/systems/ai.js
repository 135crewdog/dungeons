// Enemy behaviour. An enemy aggroes the moment it can see the player (symmetric
// FOV means "the player can see it" ⇔ "it can see the player"). While it has
// line of sight it attacks if adjacent, else steps one A* tile toward the
// player. When it loses sight it heads for the last tile it saw the player on,
// and gives up (holds position, re-aggros only on a fresh sighting) once it
// gets there empty-handed or after DEAGGRO_TURNS turns blind. Un-aggroed
// enemies hold position.

import { getPlayer, isVisible, isAdjacent, entityAt, isWalkable } from '../core/query.js';
import { DEAGGRO_TURNS } from '../core/constants.js';
import { tryMove } from '../core/movement.js';
import { resolveAttack } from './combat.js';
import { aStar } from './pathfinding.js';

// Run one enemy's turn, returning the events it produced.
export function enemyTurn(state, enemyId) {
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
    const step = stepToward(state, enemy, enemy.lastSeen);
    if (step) tryMove(state, enemy, step.dx, step.dy, events);
    return events;
  }

  // Lost sight: give up once the trail runs cold (reached the last-seen tile
  // with no player there) or after too many blind turns; otherwise keep heading
  // for where the player was last seen.
  enemy.lostSightTurns++;
  const atLastSeen =
    enemy.lastSeen && enemy.x === enemy.lastSeen.x && enemy.y === enemy.lastSeen.y;
  if (!enemy.lastSeen || atLastSeen || enemy.lostSightTurns > DEAGGRO_TURNS) {
    enemy.aggro = false;
    enemy.lastSeen = null;
    enemy.lostSightTurns = 0;
    return events;
  }

  const step = stepToward(state, enemy, enemy.lastSeen);
  if (step) tryMove(state, enemy, step.dx, step.dy, events);
  return events;
}

// First step of an A* path from the enemy to a goal tile. Enemies see the whole
// map (they are not fogged). Other enemies block the path; the goal tile itself
// is always allowed (it may hold the player). Returns { dx, dy } or null.
function stepToward(state, enemy, goal) {
  if (!goal) return null;
  const map = state.map;
  const passable = (x, y) => {
    if (!isWalkable(map, x, y)) return false;
    if (x === goal.x && y === goal.y) return true; // the goal tile is allowed
    const occ = entityAt(state, x, y);
    return !occ; // route around other entities
  };
  const path = aStar(passable, { x: enemy.x, y: enemy.y }, goal, map.width);
  if (!path || path.length < 2) return null;
  const next = path[1];
  return { dx: next.x - enemy.x, dy: next.y - enemy.y };
}

// Enemy behaviour. Each enemy acts on its turn: it aggroes the moment it can
// see the player (symmetric FOV means "the player can see it" ⇔ "it can see the
// player"), then chases relentlessly — attacking if adjacent, otherwise stepping
// one A* tile toward the player. Un-aggroed enemies hold position.

import { getPlayer, isVisible, isAdjacent, entityAt, isWalkable } from '../core/query.js';
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

  if (!enemy.aggro && isVisible(state, enemy.x, enemy.y)) {
    enemy.aggro = true;
  }
  if (!enemy.aggro) return events;

  if (isAdjacent(enemy.x, enemy.y, player.x, player.y)) {
    return resolveAttack(state, enemy.id, player.id);
  }

  const step = stepToward(state, enemy, player);
  if (step) tryMove(state, enemy, step.dx, step.dy, events);
  return events;
}

// First step of an A* path from the enemy to the player. Enemies see the whole
// map (they are not fogged). Other enemies block the path; the player's tile is
// the goal and is allowed. Returns { dx, dy } or null.
function stepToward(state, enemy, player) {
  const map = state.map;
  const goal = { x: player.x, y: player.y };
  const passable = (x, y) => {
    if (!isWalkable(map, x, y)) return false;
    if (x === goal.x && y === goal.y) return true; // the player's tile is the goal
    const occ = entityAt(state, x, y);
    return !occ; // route around other entities
  };
  const path = aStar(passable, { x: enemy.x, y: enemy.y }, goal, map.width);
  if (!path || path.length < 2) return null;
  const next = path[1];
  return { dx: next.x - enemy.x, dy: next.y - enemy.y };
}

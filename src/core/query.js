// Pure read helpers over the game state. No mutation, no Phaser. These are the
// vocabulary the systems (movement, FOV, pathfinding, AI, combat) share so the
// notion of "walkable", "transparent", "known", and "occupied" is defined once.

import { TILE, SHADOW_NOTICE_RADIUS } from './constants.js';

export function idx(map, x, y) {
  return y * map.width + x;
}

export function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

// Out-of-bounds reads as WALL so callers never step off the grid.
export function tileAt(map, x, y) {
  return inBounds(map, x, y) ? map.tiles[idx(map, x, y)] : TILE.WALL;
}

// Doors are walkable but NOT transparent: you can pass through a door, but a
// closed door blocks line of sight (so nothing sees through doorways). Both
// stair tiles are walkable and transparent.
export function isWalkableTile(t) {
  return t === TILE.FLOOR || t === TILE.DOOR || t === TILE.STAIRS_DOWN || t === TILE.STAIRS_UP;
}

export function isTransparentTile(t) {
  return t === TILE.FLOOR || t === TILE.STAIRS_DOWN || t === TILE.STAIRS_UP;
}

export function isWalkable(map, x, y) {
  return isWalkableTile(tileAt(map, x, y));
}

export function isTransparent(map, x, y) {
  return isTransparentTile(tileAt(map, x, y));
}

// Stairs are walkable for the player and the click planner (isWalkableTile),
// but enemies treat them as obstacles — they can't use stairs, so they route
// around. This predicate is the enemy-only exclusion; it never gates the player.
export function isStairsTile(t) {
  return t === TILE.STAIRS_DOWN || t === TILE.STAIRS_UP;
}

// Does an item (potion or chest) sit on this tile? Items are a small unindexed
// array, so a linear scan matches entityAt's philosophy. Enemies route around
// item tiles (they can't collect them); only the player picks them up.
export function hasItemAt(state, x, y) {
  return state.items.some((it) => it.x === x && it.y === y);
}

export function isExplored(state, x, y) {
  return inBounds(state.map, x, y) && state.vis.explored[idx(state.map, x, y)] === 1;
}

export function isVisible(state, x, y) {
  return inBounds(state.map, x, y) && state.vis.visible[idx(state.map, x, y)] === 1;
}

// A tile the player may path across: known to be explored AND walkable.
// Unexplored tiles are treated as blocked until seen.
export function isKnownWalkable(state, x, y) {
  return isExplored(state, x, y) && isWalkable(state.map, x, y);
}

// Presentation-only visibility: does this tile render fully lit? True line of
// sight — or anywhere in bounds once the Ring of Sight is worn. Gameplay
// reads (AI aggro, auto-walk cancels, path planning) use isVisible/isExplored
// directly so the ring never changes what enemies or the engine can "see".
export function isRevealed(state, x, y) {
  if (isVisible(state, x, y)) return true;
  return (getPlayer(state)?.ringSight ?? false) && inBounds(state.map, x, y);
}

export function getPlayer(state) {
  return state.entities.byId.get(state.entities.playerId);
}

// First entity occupying a tile, or null. Entity counts are small (≤ ~10),
// so a linear scan is fine and keeps state free of a redundant occupancy grid.
export function entityAt(state, x, y) {
  for (const e of state.entities.byId.values()) {
    if (e.x === x && e.y === y) return e;
  }
  return null;
}

// Entities in deterministic ascending-id order — the turn engine's iteration
// order. Never rely on Map insertion order for gameplay.
export function entitiesSorted(state) {
  return [...state.entities.byId.values()].sort((a, b) => a.id - b.id);
}

export function enemiesSorted(state) {
  return entitiesSorted(state).filter((e) => e.id !== state.entities.playerId);
}

export function chebyshev(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function isAdjacent(ax, ay, bx, by) {
  return chebyshev(ax, ay, bx, by) === 1;
}

// Is this enemy blind to the player because of the Ring of Shadow?
//
// THE single definition of the rule: ai.js gates aggro on it and the headless
// balance bot reads it to decide what counts as a threat. The bot used to
// mirror the expression by hand, which is exactly the kind of duplicate that
// goes stale the first time the rule moves.
//
// Three ways cover breaks, on top of not wearing the ring at all:
//   · provoked — the player has swung near this enemy (combat.js), for good;
//   · boss — the floor's set-piece is not something you tiptoe past;
//   · proximity — within SHADOW_NOTICE_RADIUS you are simply too close to hide.
// This answers "blind", not "cannot see": callers still AND it with true line
// of sight. At SHADOW_NOTICE_RADIUS 1 that AND is a formality — shadowcasting
// marks every depth-1 tile visible, corners included — so a kitty-corner enemy
// really does notice you. It still cannot SWING through the corner
// (meleeReachable), so it aggroes and paths around, exactly like any other
// enemy a corner is standing in the way of.
export function hiddenFromEnemy(state, enemy) {
  const player = getPlayer(state);
  if (!player || !(player.ringShadow ?? false)) return false;
  if (enemy.provoked ?? false) return false;
  if (enemy.kind === 'boss') return false;
  return chebyshev(player.x, player.y, enemy.x, enemy.y) > SHADOW_NOTICE_RADIUS;
}

// No corner-cutting: a diagonal step from (x, y) by (dx, dy) is legal only when
// both orthogonal tiles between it and the mover are passable. Cardinal steps
// (dx or dy zero) are always allowed. `passable(x, y)` is the caller's tile
// predicate — isWalkable for a live entity move, the A* frontier test for
// pathfinding — so player and AI share one definition of the rule.
export function diagonalAllowed(passable, x, y, dx, dy) {
  if (dx === 0 || dy === 0) return true;
  return passable(x + dx, y) && passable(x, y + dy);
}

// Can (ax, ay) swing at (bx, by)? Adjacent AND not reaching past a wall corner.
//
// The corner rule is the same one canStep applies to a diagonal move, and both
// sides of a fight have to share it: the player's bump attack goes through
// tryMove -> canStep, so a diagonal wall corner has always blocked the player's
// swing. Adjacency alone did not, which let an enemy standing kitty-corner
// through a wall hit a player who could not hit back — and, on screen, looked
// like damage being exchanged between two entities that are not touching.
export function meleeReachable(map, ax, ay, bx, by) {
  if (!isAdjacent(ax, ay, bx, by)) return false;
  return diagonalAllowed((x, y) => isWalkable(map, x, y), ax, ay, bx - ax, by - ay);
}

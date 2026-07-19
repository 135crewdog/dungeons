// Pure read helpers over the game state. No mutation, no Phaser. These are the
// vocabulary the systems (movement, FOV, pathfinding, AI, combat) share so the
// notion of "walkable", "transparent", "known", and "occupied" is defined once.

import { TILE } from './constants.js';

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

// No corner-cutting: a diagonal step from (x, y) by (dx, dy) is legal only when
// both orthogonal tiles between it and the mover are passable. Cardinal steps
// (dx or dy zero) are always allowed. `passable(x, y)` is the caller's tile
// predicate — isWalkable for a live entity move, the A* frontier test for
// pathfinding — so player and AI share one definition of the rule.
export function diagonalAllowed(passable, x, y, dx, dy) {
  if (dx === 0 || dy === 0) return true;
  return passable(x + dx, y) && passable(x, y + dy);
}

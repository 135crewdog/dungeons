// Shared movement rules for any entity (player or enemy). Kept out of the turn
// engine so the AI can reuse it without an import cycle. A step either moves the
// entity, bump-attacks a hostile occupant (same turn), or is refused.

import { isWalkable, entityAt } from './query.js';
import { moveEvent } from './events.js';
import { resolveAttack, areHostile } from '../systems/combat.js';

// Is a single (dx, dy) step legal terrain-wise? Destination must be walkable,
// and a diagonal may not squeeze between two wall corners. Only true one-tile
// steps are legal: a non-integer or multi-tile delta (or standing still) is
// rejected up front so the pure engine can never teleport across intervening
// tiles.
export function canStep(state, entity, dx, dy) {
  if (
    !Number.isInteger(dx) ||
    !Number.isInteger(dy) ||
    Math.abs(dx) > 1 ||
    Math.abs(dy) > 1 ||
    (dx === 0 && dy === 0)
  ) {
    return false;
  }
  const map = state.map;
  const nx = entity.x + dx;
  const ny = entity.y + dy;
  if (!isWalkable(map, nx, ny)) return false;
  if (dx !== 0 && dy !== 0) {
    if (!isWalkable(map, entity.x + dx, entity.y)) return false;
    if (!isWalkable(map, entity.x, entity.y + dy)) return false;
  }
  return true;
}

// Attempt to move `entity` by (dx, dy). Returns true if a turn-consuming action
// happened (a move OR a bump-attack). Handles wall/corner-cut terrain, and tile
// occupancy: bumping a hostile attacks it; bumping an ally is refused.
export function tryMove(state, entity, dx, dy, events) {
  if (dx === 0 && dy === 0) return false;
  if (!canStep(state, entity, dx, dy)) return false;

  const nx = entity.x + dx;
  const ny = entity.y + dy;

  const occupant = entityAt(state, nx, ny);
  if (occupant && occupant.id !== entity.id) {
    if (areHostile(entity, occupant)) {
      for (const e of resolveAttack(state, entity.id, occupant.id)) events.push(e);
      return true; // attack replaces the move; entity stays put
    }
    return false; // same faction: no shared tiles, no move
  }

  const from = { x: entity.x, y: entity.y };
  entity.x = nx;
  entity.y = ny;
  events.push(moveEvent(entity.id, from, { x: nx, y: ny }));
  return true;
}

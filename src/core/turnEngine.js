// The game's heartbeat. processCommand runs one full turn in the strict order
// from the briefing and returns the events it produced. It mutates the state in
// place (the state is the single source of truth) but never touches the
// renderer. Enemy AI, item pickups, and FOV are layered into advanceWorld in
// later milestones; the ordering contract is established here.

import { getPlayer, isWalkable, entityAt } from './query.js';
import { moveEvent } from './events.js';

// Run a turn from a player command. Returns events, or an empty array if the
// command was invalid / a no-op (in which case the turn is NOT consumed and the
// world does not advance).
export function processCommand(state, command) {
  if (state.status !== 'playing') return [];

  const events = [];
  const acted = executePlayerAction(state, command, events);
  if (!acted) return events;

  advanceWorld(state, events);
  return events;
}

function executePlayerAction(state, command, events) {
  const player = getPlayer(state);
  if (!player) return false;

  if (command.type === 'move') {
    return tryMove(state, player, command.dx, command.dy, events);
  }
  return false;
}

// Attempt to move `entity` by (dx, dy). Returns true if a turn-consuming action
// happened. Handles wall collision, diagonal corner-cutting, and occupancy.
export function tryMove(state, entity, dx, dy, events) {
  if (dx === 0 && dy === 0) return false;
  if (!canStep(state, entity, dx, dy)) return false;

  const nx = entity.x + dx;
  const ny = entity.y + dy;

  const occupant = entityAt(state, nx, ny);
  if (occupant && occupant.id !== entity.id) {
    // A different entity holds the target tile. Bump-combat lands in a later
    // milestone; for now the move is simply blocked (no shared tiles).
    return false;
  }

  const from = { x: entity.x, y: entity.y };
  entity.x = nx;
  entity.y = ny;
  events.push(moveEvent(entity.id, from, { x: nx, y: ny }));
  return true;
}

// Is a single step by (dx, dy) legal terrain-wise? Destination must be
// walkable, and a diagonal may not squeeze between two wall corners.
export function canStep(state, entity, dx, dy) {
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

// Everything that happens after the player acts. Enemy turns, pickups, and FOV
// are added here in later milestones — in the briefing's order.
function advanceWorld(state, events) {
  state.turn++;
}

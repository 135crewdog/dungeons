// The game's heartbeat. processCommand runs one full turn in the strict order
// from the briefing and returns the events it produced. It mutates state in
// place (the single source of truth) but never touches the renderer.

import { getPlayer, enemiesSorted } from './query.js';
import { tryMove } from './movement.js';
import { updateVisibility } from '../systems/visibility.js';
import { enemyTurn } from '../systems/ai.js';

// Run a turn from a player command. Returns events, or an empty array if the
// command was invalid / a no-op (the turn is NOT consumed and the world does
// not advance).
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

// Everything after the player acts, in the briefing's order. FOV is recomputed
// right after the player moves — it depends only on walls + player position, so
// it is stable through the enemy phase, and it gives enemies correct
// line-of-sight for aggro this same turn.
function advanceWorld(state, events) {
  state.turn++;
  // Step 5 (computed early, see above): update field of view and visibility.
  updateVisibility(state);
  // Step 3: each enemy acts in ascending id order.
  enemyPhase(state, events);
  // Step 4 (item pickups) is layered in with items.
}

function enemyPhase(state, events) {
  for (const enemy of enemiesSorted(state)) {
    if (state.status !== 'playing') break; // player died mid-phase
    if (!state.entities.byId.has(enemy.id)) continue; // safety
    for (const e of enemyTurn(state, enemy.id)) events.push(e);
  }
}

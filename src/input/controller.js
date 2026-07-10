// Bridges raw input commands to the turn engine. It calls simulation actions
// and notifies the caller when a turn was consumed (so the renderer can
// repaint), but it never touches the renderer or the state directly. The
// stored-path auto-walk scheduler is added with click/tap pathfinding later.

import { processCommand } from '../core/turnEngine.js';

export function createController(state, onTurn) {
  function dispatch(command) {
    if (state.status !== 'playing') return;
    const events = processCommand(state, command);
    if (events.length > 0) onTurn(events);
  }

  return { dispatch };
}

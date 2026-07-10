// Bridges input commands to the turn engine and drives click/tap auto-walk. It
// calls simulation actions and notifies the caller when a turn was consumed (so
// the renderer can repaint), but never touches the renderer or state directly.
//
// Auto-walk executes one stored-path step per turn on a short timer. It cancels
// when: a new enemy comes into view, the player takes damage, the path becomes
// invalid (blocked / a step didn't land), or a new command arrives.

import {
  processCommand,
  planPath,
  nextPathStep,
  pathFinished,
  clearPath,
} from '../core/turnEngine.js';
import { STEP_DELAY_MS } from '../core/constants.js';
import { getPlayer, enemiesSorted, isVisible } from '../core/query.js';

export function createController(state, onTurn, schedule = defaultSchedule) {
  let cancelTimer = null;
  let baselineSeen = new Set();

  function stopAutoWalk() {
    if (cancelTimer) {
      cancelTimer();
      cancelTimer = null;
    }
    clearPath(state);
  }

  function runTurn(command) {
    const events = processCommand(state, command);
    if (events.length > 0) onTurn(events);
    return events;
  }

  function visibleEnemyIds() {
    const ids = new Set();
    for (const e of enemiesSorted(state)) {
      if (isVisible(state, e.x, e.y)) ids.add(e.id);
    }
    return ids;
  }

  function dispatch(command) {
    if (state.status !== 'playing') return;
    // Any explicit command cancels an in-progress auto-walk.
    stopAutoWalk();

    if (command.type === 'move') {
      runTurn(command);
      return;
    }
    if (command.type === 'moveTo') {
      if (!planPath(state, command.x, command.y)) return;
      baselineSeen = visibleEnemyIds(); // enemies already in view don't cancel
      stepAlongPath();
    }
  }

  function stepAlongPath() {
    cancelTimer = null;
    const player = getPlayer(state);
    const step = nextPathStep(state);
    if (!step) return stopAutoWalk();

    const hpBefore = player.hp;
    const targetX = player.x + step.dx;
    const targetY = player.y + step.dy;
    runTurn({ type: 'move', dx: step.dx, dy: step.dy });

    // Cancellation conditions, in order.
    if (state.status !== 'playing') return stopAutoWalk();
    if (player.x !== targetX || player.y !== targetY) return stopAutoWalk(); // blocked / bumped / descended
    if (player.hp < hpBefore) return stopAutoWalk(); // took damage
    for (const id of visibleEnemyIds()) {
      if (!baselineSeen.has(id)) return stopAutoWalk(); // a new enemy entered view
    }
    if (pathFinished(state)) return stopAutoWalk(); // arrived

    cancelTimer = schedule(stepAlongPath, STEP_DELAY_MS);
  }

  return { dispatch };
}

// Default scheduler: setTimeout, returning a canceller. Injectable for tests.
function defaultSchedule(fn, ms) {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
}

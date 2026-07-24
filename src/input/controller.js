// Bridges input commands to the turn engine and drives click/tap auto-walk. It
// calls simulation actions and notifies the caller when a turn was consumed (so
// the renderer can repaint), but never touches the renderer or state directly.
//
// Auto-walk executes one stored-path step per turn on a short timer. It cancels
// when: a new enemy comes into view, the player takes damage, the path becomes
// invalid (blocked / a step didn't land), or a new command arrives. Clicking a
// visible enemy is an attack intent instead: the path re-aims at the enemy's
// current tile every turn and, on reaching melee range, lands one bump attack
// and stops (one swing per click) — same cancellation rules while closing in
// (except damage taken on the very step that reached melee, since the swing is
// the next action), plus losing the target (dead or out of sight) ends it.

import {
  processCommand,
  planPath,
  nextPathStep,
  pathFinished,
  clearPath,
} from '../core/turnEngine.js';
import { STEP_DELAY_MS } from '../core/constants.js';
import { getPlayer, enemiesSorted, isVisible, entityAt, isAdjacent } from '../core/query.js';
import { canStep } from '../core/movement.js';

export function createController(state, onTurn, schedule = defaultSchedule) {
  let cancelTimer = null;
  let baselineSeen = new Set();
  let targetId = null; // enemy id being pursued, null outside attack intent

  function stopAutoWalk() {
    if (cancelTimer) {
      cancelTimer();
      cancelTimer = null;
    }
    targetId = null;
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
      const target = entityAt(state, command.x, command.y);
      if (
        target &&
        target.id !== state.entities.playerId &&
        isVisible(state, command.x, command.y)
      ) {
        targetId = target.id;
        baselineSeen = visibleEnemyIds(); // the target is visible, so it's in the baseline
        stepTowardTarget();
        return;
      }
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

  function stepTowardTarget() {
    cancelTimer = null;
    const player = getPlayer(state);
    const target = state.entities.byId.get(targetId);
    if (!target || !isVisible(state, target.x, target.y)) return stopAutoWalk(); // dead or lost sight

    // In melee range with a legal step (diagonals respect the corner-cut rule):
    // deliver the bump attack and stop — one swing per click.
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    if (isAdjacent(player.x, player.y, target.x, target.y) && canStep(state, player, dx, dy)) {
      runTurn({ type: 'move', dx, dy });
      return stopAutoWalk();
    }

    // Re-aim at the enemy's current tile every turn so the pursuit tracks it.
    if (!planPath(state, target.x, target.y)) return stopAutoWalk();
    const step = nextPathStep(state);
    if (!step) return stopAutoWalk();

    const hpBefore = player.hp;
    const targetX = player.x + step.dx;
    const targetY = player.y + step.dy;
    runTurn({ type: 'move', dx: step.dx, dy: step.dy });

    // Same cancellation conditions as a plain walk, in the same order, with one
    // carve-out: enemies strike the moment the player steps into melee range,
    // so damage taken on the step that REACHED the target doesn't abort — the
    // next tick is the promised swing, and the pursuit stops right after it.
    // (A bump here can itself be the swing, if the target stepped into the
    // path — either way the pursuit ends and the next click is the next swing.)
    if (state.status !== 'playing') return stopAutoWalk();
    if (player.x !== targetX || player.y !== targetY) return stopAutoWalk(); // blocked / bumped / descended
    const atMelee = isAdjacent(player.x, player.y, target.x, target.y);
    if (player.hp < hpBefore && !atMelee) return stopAutoWalk(); // took damage while crossing
    for (const id of visibleEnemyIds()) {
      if (!baselineSeen.has(id)) return stopAutoWalk(); // a new enemy entered view
    }

    cancelTimer = schedule(stepTowardTarget, STEP_DELAY_MS);
  }

  // Cancel any in-progress auto-walk without issuing a command. Used when the
  // game is paused (e.g. the menu opens) so the player doesn't keep stepping.
  function cancel() {
    stopAutoWalk();
  }

  return { dispatch, cancel };
}

// Default scheduler: setTimeout, returning a canceller. Injectable for tests.
function defaultSchedule(fn, ms) {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
}

// The game's heartbeat. processCommand runs one full turn in the strict order
// from the briefing and returns the events it produced. It mutates state in
// place (the single source of truth) but never touches the renderer.

import { getPlayer, enemiesSorted, tileAt, isKnownWalkable } from './query.js';
import { TILE, CHEST_EFFECT } from './constants.js';
import { tryMove } from './movement.js';
import { descend, ascend } from './gameState.js';
import { pushLog } from './entity.js';
import { pickupEvent, descendEvent, ascendEvent, deathEvent } from './events.js';
import { updateVisibility } from '../systems/visibility.js';
import { enemyTurn, buildOccupancy } from '../systems/ai.js';
import { mitigatedDamage } from '../systems/combat.js';
import { aStar } from '../systems/pathfinding.js';

// Run a turn from a player command. Returns events, or an empty array if the
// command was invalid / a no-op (the turn is NOT consumed and the world does
// not advance).
export function processCommand(state, command) {
  if (state.status !== 'playing') return [];

  const events = [];
  const player = getPlayer(state);
  const fromX = player.x;
  const fromY = player.y;
  const acted = executePlayerAction(state, command, events);
  if (!acted) return events;

  // Stepping onto a staircase ends this floor immediately: swap floors and skip
  // the enemy phase (the player has left this floor behind). Only a real step
  // onto the stair counts — not a bump-attack made while already standing on it,
  // nor the tile the player was placed on when they arrived — so the player
  // doesn't ricochet straight back the way they came.
  const movedOntoTile = player.x !== fromX || player.y !== fromY;
  if (movedOntoTile) {
    const tile = tileAt(state.map, player.x, player.y);
    if (tile === TILE.STAIRS_DOWN) {
      descend(state);
      pushLog(state, 'descend', { floor: state.floor });
      events.push(descendEvent(state.floor));
      return events;
    }
    if (tile === TILE.STAIRS_UP) {
      ascend(state);
      pushLog(state, 'ascend', { floor: state.floor });
      events.push(ascendEvent(state.floor));
      return events;
    }
  }

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
  // Step 4: resolve item pickups (the player walking over an item).
  resolvePickups(state, events);
}

// If the player stands on an item, apply it and remove it. Potions heal up to
// max HP (the excess is wasted). Chests grant their spawn-rolled bonus — or
// spring their trap, which respects armor and can kill.
function resolvePickups(state, events) {
  if (state.status !== 'playing') return; // killed in the enemy phase: no loot
  const player = getPlayer(state);
  const i = state.items.findIndex((it) => it.x === player.x && it.y === player.y);
  if (i === -1) return;
  const item = state.items[i];

  if (item.type === 'potion') {
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + item.heal);
    const healed = player.hp - before;
    state.items.splice(i, 1);
    events.push(pickupEvent(item.id, item.x, item.y, { item: 'potion', heal: healed }));
    pushLog(state, 'pickup', { item: 'potion', heal: healed });
    return;
  }

  if (item.type === 'chest') {
    state.items.splice(i, 1);
    openChest(state, player, item, events);
  }
}

function openChest(state, player, item, events) {
  const { effect } = item;
  let amount = item.amount;
  let heal = 0;

  if (effect === CHEST_EFFECT.STRENGTH) {
    player.strength = (player.strength ?? 0) + amount;
  } else if (effect === CHEST_EFFECT.SKILL) {
    player.skill = (player.skill ?? 0) + amount;
  } else if (effect === CHEST_EFFECT.ARMOR) {
    player.armor = (player.armor ?? 0) + amount;
  } else if (effect === CHEST_EFFECT.HEALTH) {
    player.maxHp += amount;
    heal = player.maxHp - player.hp;
    player.hp = player.maxHp;
  } else if (effect === CHEST_EFFECT.TRAP) {
    amount = mitigatedDamage(item.amount, player.armor ?? 0); // report applied damage
    player.hp -= amount;
  }

  events.push(pickupEvent(item.id, item.x, item.y, { item: 'chest', effect, amount, heal }));
  pushLog(state, 'pickup', { item: 'chest', effect, amount });

  if (player.hp <= 0) {
    player.hp = 0;
    events.push(deathEvent(player.id, 'player'));
    pushLog(state, 'death', { kind: 'player' });
    // Keep the player entity in place for the game-over frame; stop the run.
    state.status = 'dead';
  }
}

function enemyPhase(state, events) {
  // Build the tile-occupancy set once and share it across the whole phase; each
  // enemy keeps it live as it steps (see ai.buildOccupancy).
  const occupied = buildOccupancy(state);
  for (const enemy of enemiesSorted(state)) {
    if (state.status !== 'playing') break; // player died mid-phase
    if (!state.entities.byId.has(enemy.id)) continue; // safety
    for (const e of enemyTurn(state, enemy.id, occupied)) events.push(e);
  }
}

// --- Click/tap auto-walk path planning ---------------------------------------

// Plan a path from the player to (tx, ty) over ONLY known-walkable tiles
// (unexplored is treated as blocked). Stores it on state.path and returns true
// if a usable path exists; a click on an unknown or unreachable tile is a no-op.
export function planPath(state, tx, ty) {
  const player = getPlayer(state);
  if (tx === player.x && ty === player.y) return false;
  if (!isKnownWalkable(state, tx, ty)) return false;

  const passable = (x, y) => isKnownWalkable(state, x, y);
  const path = aStar(passable, { x: player.x, y: player.y }, { x: tx, y: ty }, state.map.width);
  if (!path || path.length < 2) return false;

  state.path = { nodes: path, index: 0 };
  return true;
}

// The next step of the stored path as { dx, dy }, advancing the path cursor; or
// null if there is no path, it is finished, or the next tile is no longer valid.
export function nextPathStep(state) {
  const p = state.path;
  if (!p || p.index >= p.nodes.length - 1) return null;
  const cur = p.nodes[p.index];
  const nxt = p.nodes[p.index + 1];
  if (!isKnownWalkable(state, nxt.x, nxt.y)) return null;
  p.index++;
  return { dx: nxt.x - cur.x, dy: nxt.y - cur.y };
}

export function pathFinished(state) {
  const p = state.path;
  return !p || p.index >= p.nodes.length - 1;
}

export function clearPath(state) {
  state.path = null;
}

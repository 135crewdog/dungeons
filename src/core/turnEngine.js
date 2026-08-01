// The game's heartbeat. processCommand runs one full turn in the strict order
// from the briefing and returns the events it produced. It mutates state in
// place (the single source of truth) but never touches the renderer.

import {
  getPlayer,
  enemiesSorted,
  tileAt,
  isKnownWalkable,
  isStairsTile,
  isVisible,
  entityAt,
  hasItemAt,
  chebyshev,
} from './query.js';
import { TILE, CHEST_EFFECT, KEY_REVEAL_RADIUS, RING_FLAG, DIRS8 } from './constants.js';
import { tryMove, canStep } from './movement.js';
import { descend, ascend } from './gameState.js';
import { pushLog, allocId } from './entity.js';
import {
  EV,
  pickupEvent,
  revealEvent,
  lockedEvent,
  descendEvent,
  ascendEvent,
  deathEvent,
} from './events.js';
import { createRing } from '../entities/items.js';
import { updateVisibility } from '../systems/visibility.js';
import { enemyTurn, buildOccupancy } from '../systems/ai.js';
import { mitigatedDamage, tryRingSurvival } from '../systems/combat.js';
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

  // One successful player command consumes exactly one turn — counted here,
  // before the stair check, so a floor transition (which skips the departed
  // floor's consequences below) still costs a turn like any other move. The
  // count is the leaderboard's tie-break, so a "free" step would flatter the
  // score. Ring-of-Speed's second step is part of the same command and never
  // counts again.
  state.turn++;

  if (resolveStairStep(state, player, fromX, fromY, events)) return events;

  // Ring of Speed: one extra step in the same direction, unless the command
  // opted out (`single: true` — auto-walk path corners do), the first action
  // was a bump-attack (an attack consumes the whole turn), or the player just
  // stepped onto loot (you stop over an item — this keeps pickups
  // un-skippable, and the balance bots overshoot-safe). Visibility and key
  // reveals run between the steps so the intermediate tile is explored — and
  // can glimmer — like any other tile walked over. The extra step never
  // attacks: it is silently skipped when the tile is blocked or occupied. If
  // it lands on stairs the floor swaps right here, same as a first step.
  const movedFirst = player.x !== fromX || player.y !== fromY;
  if (
    (player.ringSpeed ?? false) &&
    !command.single &&
    movedFirst &&
    !hasItemAt(state, player.x, player.y)
  ) {
    updateVisibility(state);
    revealNearbyKeys(state, events);
    const stepX = player.x;
    const stepY = player.y;
    if (
      canStep(state, player, command.dx, command.dy) &&
      !entityAt(state, stepX + command.dx, stepY + command.dy)
    ) {
      tryMove(state, player, command.dx, command.dy, events);
      if (resolveStairStep(state, player, stepX, stepY, events)) return events;
    }
  }

  advanceWorld(state, events);
  return events;
}

// Stepping onto a staircase ends this floor immediately: swap floors and skip
// the enemy phase (the player has left this floor behind). Only a real step
// onto the stair counts — not a bump-attack made while already standing on it,
// nor the tile the player was placed on when they arrived — so the player
// doesn't ricochet straight back the way they came. Returns true when the
// floor changed: the caller must stop cold (the whole floor state was swapped,
// and any remaining Ring-of-Speed step is forfeited).
//
// Arriving still runs the key-reveal pass. descend/ascend compute FOV for the
// arrival tile, but the rest of the turn is skipped, so until 0.9.8 a key
// sitting within reveal range of the arrival stair only glimmered on the NEXT
// command — the player was standing next to it, looking at it, and the game
// waited a turn to say so. Reveals draw no RNG, so this costs nothing.
function resolveStairStep(state, player, fromX, fromY, events) {
  if (player.x === fromX && player.y === fromY) return false;
  const tile = tileAt(state.map, player.x, player.y);
  if (tile === TILE.STAIRS_DOWN) {
    descend(state);
    pushLog(state, 'descend', { floor: state.floor });
    events.push(descendEvent(state.floor));
    revealNearbyKeys(state, events);
    return true;
  }
  if (tile === TILE.STAIRS_UP) {
    if (!ascend(state)) return false; // refused (floor 1): not a floor change
    pushLog(state, 'ascend', { floor: state.floor });
    events.push(ascendEvent(state.floor));
    revealNearbyKeys(state, events);
    return true;
  }
  return false;
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
// line-of-sight for aggro this same turn. The turn counter is NOT touched here:
// it belongs to the player's command (see processCommand), and this function is
// skipped entirely when the player takes the stairs.
function advanceWorld(state, events) {
  // Field of view first: it depends only on walls and the player's position, so
  // computing it here makes it stable for the rest of the turn.
  updateVisibility(state);
  // Hidden keys glimmer as soon as the fresh FOV is in — before enemies act
  // and before pickups, so stepping straight onto a hidden key reveals then
  // collects it in this same turn.
  revealNearbyKeys(state, events);
  // Enemies act in ascending id order.
  enemyPhase(state, events);
  // Item pickups last: the player walking over an item collects it.
  const sightBefore = getPlayer(state)?.ringSight ?? false;
  resolvePickups(state, events);
  // Picking up the Ring of Sight happens AFTER this turn's FOV pass, so its
  // floor-wide `explored` fill would not land until the next command — the
  // floor lit up instantly (the renderer reads query.isRevealed) but click
  // pathing across it silently lagged a turn behind what the player could see.
  // One extra pass closes that. It is cheap and safe: the player has not moved
  // since the pass above, so `visible` recomputes identically, revealRoom is
  // guarded by _revealedRoom, and no RNG is drawn. Reading the flag after the
  // fact catches both routes to it — the ring pickup and dropRing's boxed-in
  // direct set.
  if (!sightBefore && (getPlayer(state)?.ringSight ?? false)) updateVisibility(state);
}

// Hidden keys blink into view when the player passes close by: within
// KEY_REVEAL_RADIUS tiles (Chebyshev) AND currently inside the player's FOV —
// no glimmers through walls or closed doors.
function revealNearbyKeys(state, events) {
  const player = getPlayer(state);
  if (!player) return;
  for (const item of state.items) {
    if (item.type !== 'key' || !item.hidden) continue;
    if (chebyshev(player.x, player.y, item.x, item.y) > KEY_REVEAL_RADIUS) continue;
    if (!isVisible(state, item.x, item.y)) continue;
    item.hidden = false;
    events.push(revealEvent(item.id, item.x, item.y));
    pushLog(state, 'reveal', {});
  }
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
    return;
  }

  if (item.type === 'key') {
    if (item.hidden) return; // defensive: the reveal pass always runs first
    player.keys = (player.keys ?? 0) + 1;
    state.items.splice(i, 1);
    events.push(pickupEvent(item.id, item.x, item.y, { item: 'key' }));
    pushLog(state, 'pickup', { item: 'key' });
    return;
  }

  if (item.type === 'ring') {
    player[RING_FLAG[item.ring]] = true;
    state.items.splice(i, 1);
    events.push(pickupEvent(item.id, item.x, item.y, { item: 'ring', effect: item.ring }));
    pushLog(state, 'pickup', { item: 'ring', ring: item.ring });
    return;
  }

  if (item.type === 'lockedChest') {
    if ((player.keys ?? 0) > 0) {
      player.keys--;
      state.items.splice(i, 1);
      events.push(pickupEvent(item.id, item.x, item.y, { item: 'lockedChest', effect: item.ring }));
      pushLog(state, 'unlock', { ring: item.ring });
      dropRing(state, item.x, item.y, item.ring, player, events);
    } else if (events.some((e) => e.type === EV.MOVE && e.id === player.id)) {
      // Locked and keyless: the chest is never spliced, so announce only on
      // the turn the player ARRIVES (this turn has a player move event). A
      // stationary bump-attack turn on the tile stays silent; stepping off
      // and back on re-announces.
      events.push(lockedEvent(item.x, item.y));
      pushLog(state, 'locked', {});
    }
    return;
  }
}

// The unlocked chest's ring tumbles onto the first adjacent unoccupied,
// item-free floor/door tile — the same deterministic DIRS8 scan as the boss
// chest drop (no RNG draw, so replays match). The player is standing ON the
// chest tile, so the ring never lands underfoot; if every neighbor is blocked
// (vanishingly rare) it goes straight onto the player's finger instead.
function dropRing(state, x, y, ring, player, events) {
  for (const { dx, dy } of DIRS8) {
    const nt = tileAt(state.map, x + dx, y + dy);
    const free =
      (nt === TILE.FLOOR || nt === TILE.DOOR) &&
      !entityAt(state, x + dx, y + dy) &&
      !state.items.some((it) => it.x === x + dx && it.y === y + dy);
    if (free) {
      const item = createRing(x + dx, y + dy, ring);
      item.id = allocId(state);
      state.items.push(item);
      return;
    }
  }
  // Boxed in: the ring goes straight onto the finger. It still has to ANNOUNCE
  // itself the same way a walked-over ring does — this branch used to set the
  // flag silently, so the player read "a ring tumbles out!" and then nothing:
  // no float, and a message log that never named which ring they had just been
  // given. Reachable in ordinary play, since the enemy phase runs before
  // pickups and a chaser can seal a dead-end alcove behind you.
  player[RING_FLAG[ring]] = true;
  events.push(pickupEvent(0, x, y, { item: 'ring', effect: ring }));
  pushLog(state, 'pickup', { item: 'ring', ring });
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

  if (player.hp <= 0 && !tryRingSurvival(state, player, events)) {
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
//
// The route also steers around STAIRCASES. Stepping onto one swaps the floor
// immediately (resolveStairStep), so a staircase that merely happens to lie
// between the player and where they clicked would end the floor by accident —
// never what the click meant. The clicked tile itself is exempt: clicking the
// stairs is how you take them. When no stair-free route exists at all (a
// staircase sitting in a one-wide chokepoint) the walk goes as far as the tile
// BEFORE the staircase and stops, so changing floors always costs a second,
// deliberate command rather than happening mid-walk.
//
// Enemies have avoided stairs since Phase 1 (ai.js stepToward) and so do the
// headless balance bots; the player was the only mover without the rule.
export function planPath(state, tx, ty) {
  const player = getPlayer(state);
  // Drop any previous path FIRST. Every failure exit below returns false, and
  // "false" must not read as "the old path is still installed and walkable" —
  // today's callers all stop the walk on failure, but that is their discipline,
  // not this function's contract.
  state.path = null;
  if (tx === player.x && ty === player.y) return false;
  if (!isKnownWalkable(state, tx, ty)) return false;

  const start = { x: player.x, y: player.y };
  const goal = { x: tx, y: ty };
  const known = (x, y) => isKnownWalkable(state, x, y);
  const stairFree = (x, y) =>
    known(x, y) && ((x === tx && y === ty) || !isStairsTile(tileAt(state.map, x, y)));

  let path = aStar(stairFree, start, goal, state.map.width);
  if (!path || path.length < 2) {
    path = truncateBeforeStairs(state, aStar(known, start, goal, state.map.width), tx, ty);
  }
  if (!path || path.length < 2) return false;

  state.path = { nodes: path, index: 0 };
  return true;
}

// Cut a path short at the first staircase it would step onto, keeping the tile
// before it. The start node is never trimmed (arriving by stairs leaves the
// player standing on one) and the goal is never trimmed (that click was
// deliberate). A path whose very next step is the staircase becomes too short
// to walk and the click falls through to a no-op — the player is already
// standing next to the stairs and can take that one step by hand.
function truncateBeforeStairs(state, path, tx, ty) {
  if (!path) return null;
  for (let i = 1; i < path.length; i++) {
    const n = path[i];
    if (n.x === tx && n.y === ty) break;
    if (isStairsTile(tileAt(state.map, n.x, n.y))) return path.slice(0, i);
  }
  return path;
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

// One or two stored-path steps for this turn. The double is taken only when
// `allowDouble` (the Ring of Speed) AND the next two nodes continue in the
// same direction — the engine's extra step can only repeat a direction, so a
// path corner must be walked one tile at a time. Returns { dx, dy, steps } or
// null (same invalidation contract as nextPathStep).
export function nextPathStepMulti(state, allowDouble) {
  const step = nextPathStep(state);
  if (!step) return null;
  if (allowDouble) {
    const p = state.path;
    const cur = p.nodes[p.index];
    const nxt = p.nodes[p.index + 1];
    if (
      nxt &&
      nxt.x - cur.x === step.dx &&
      nxt.y - cur.y === step.dy &&
      isKnownWalkable(state, nxt.x, nxt.y)
    ) {
      p.index++;
      return { dx: step.dx, dy: step.dy, steps: 2 };
    }
  }
  return { dx: step.dx, dy: step.dy, steps: 1 };
}

// Walk the path cursor back one node: the engine forfeited the second half of
// a double step (loot underfoot, occupied tile), so the un-walked node must be
// re-issued on the next tick instead of being skipped.
export function rewindPathStep(state) {
  if (state.path && state.path.index > 0) state.path.index--;
}

export function pathFinished(state) {
  const p = state.path;
  return !p || p.index >= p.nodes.length - 1;
}

export function clearPath(state) {
  state.path = null;
}

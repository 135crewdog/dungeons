// Combat resolution. Pure with respect to the renderer: it mutates HP on the
// state and returns events describing what happened (hit/miss/death) so the
// renderer can float numbers. All randomness goes through the game RNG.

import {
  HIT_DIE,
  HIT_THRESHOLD,
  TILE,
  DIRS8,
  SHADOW_NOISE_RADIUS,
  SURVIVAL_HEAL_FRACTION,
} from '../core/constants.js';
import { nextInt } from '../core/rng.js';
import { attackEvent, deathEvent, survivalEvent } from '../core/events.js';
import { pushLog, allocId } from '../core/entity.js';
import { tileAt, entityAt, enemiesSorted, chebyshev } from '../core/query.js';
import { createBossChest } from '../entities/items.js';

// Damage after armor. A >0 raw hit always lands for at least 1 (armor can't
// make anyone invincible); a 0 raw hit stays 0.
export function mitigatedDamage(raw, armor) {
  if (raw <= 0) return 0;
  return Math.max(1, raw - armor);
}

// Resolve one attack from attacker to target. Returns the events produced.
export function resolveAttack(state, attackerId, targetId) {
  const events = [];
  const attacker = state.entities.byId.get(attackerId);
  const target = state.entities.byId.get(targetId);
  if (!attacker || !target) return events;

  // The player's swing — hit or miss — is NOISE. It provokes the target and
  // every enemy within earshot of the player, deliberately through walls:
  // sound is not sight, and a fight in a small room should wake the room. This
  // is what stops a Ring-of-Shadow player picking a pack apart one at a time
  // while the neighbours stay oblivious. `provoked` is read only by the Shadow
  // gate (query.hiddenFromEnemy), so this stays harmless bookkeeping when the
  // ring isn't worn — and it draws no RNG, so a ringless run is unchanged.
  if (attackerId === state.entities.playerId) {
    target.provoked = true;
    for (const e of enemiesSorted(state)) {
      if (chebyshev(attacker.x, attacker.y, e.x, e.y) <= SHADOW_NOISE_RADIUS) e.provoked = true;
    }
  }

  // To-hit: roll a d20 — a natural 1 always misses; otherwise the attack
  // lands if roll + skill clears the threshold. Every combatant resolves
  // through this same pair of rolls (a miss costs one RNG draw, a landed hit
  // two): d20 to hit, then the attacker's damage die + strength, minus armor.
  const roll = nextInt(state.rng, 1, HIT_DIE);
  const hit = roll > 1 && roll + (attacker.skill ?? 0) >= HIT_THRESHOLD;
  if (!hit) {
    events.push(attackEvent(attackerId, targetId, false, 0, target.x, target.y, roll));
    pushLog(state, 'miss', { attacker: attacker.kind, target: target.kind, roll });
    return events;
  }

  const raw = nextInt(state.rng, 1, attacker.attackDie) + (attacker.strength ?? 0);
  const damage = mitigatedDamage(raw, target.armor ?? 0);
  target.hp -= damage;
  events.push(attackEvent(attackerId, targetId, true, damage, target.x, target.y, roll));
  pushLog(state, 'hit', { attacker: attacker.kind, target: target.kind, damage, roll });

  if (target.hp <= 0) {
    // The Ring of Survival cheats exactly one death: a partial heal instead of
    // the grave, and the ring is spent.
    if (target.id === state.entities.playerId && tryRingSurvival(state, target, events)) {
      return events;
    }
    target.hp = 0;
    events.push(deathEvent(target.id, target.kind));
    pushLog(state, 'death', { kind: target.kind });
    if (target.id === state.entities.playerId) {
      // Keep the player entity in place for the game-over frame; stop the run.
      state.status = 'dead';
    } else {
      state.entities.byId.delete(target.id);
      if (target.kind === 'boss') dropBossChest(state, target.x, target.y);
    }
  }
  return events;
}

// A slain boss always leaves a bonus chest, normally right where it fell —
// which is never under the player, since two entities never share a tile.
//
// Two death tiles can't hold it, and both shift the drop to the first adjacent
// unoccupied, item-free floor/door tile (deterministic DIRS8 scan; no RNG draw,
// so replays match):
//
//  - A STAIRCASE swallows the pickup: a player stepping onto stairs changes
//    floor before pickups resolve, so the chest would be unreachable.
//  - A tile that ALREADY HOLDS AN ITEM would end up with two, breaking the
//    one-item-per-tile invariant. A boss reaches one only when boxed in (enemies
//    route around item tiles), so this is rare rather than impossible.
//
// Occupied tiles are excluded from the scan so the chest can't land under the
// attacking player (which would open it instantly via resolvePickups) or under
// another enemy. If the scan comes up empty — every neighbor wall, occupied or
// littered, which a room-bound boss fight makes vanishingly unlikely — the
// chest still drops on the death tile: a reward that is awkward to collect
// beats no reward at all.
function dropBossChest(state, x, y) {
  let dropX = x;
  let dropY = y;
  // One predicate for "a chest can sit here", applied to the death tile and
  // then to its neighbors — a staircase fails it on the tile type, a littered
  // tile on the item check. The dying boss is already out of state.entities by
  // the time this runs, so its own tile reads as unoccupied.
  const free = (fx, fy) => {
    const ft = tileAt(state.map, fx, fy);
    return (
      (ft === TILE.FLOOR || ft === TILE.DOOR) &&
      !entityAt(state, fx, fy) &&
      !state.items.some((it) => it.x === fx && it.y === fy)
    );
  };
  if (!free(x, y)) {
    // Widening BFS in DIRS8 order rather than a single ring — the same shape,
    // and for the same reason, as ensureArrivalClear. A single ring had to fall
    // back to the DEATH TILE when it found nothing, and that tile is the one
    // already known to fail the check: a boss dying on loot in a pocket stacked
    // its chest on that loot, re-breaking the very invariant this relocation
    // exists to protect. Searching outward means "nowhere to put it" can only
    // happen on a floor with no free tile at all. Ring 1 is explored first and
    // in DIRS8 order, so every case a ring scan already handled resolves to the
    // identical tile — the balance simulator's byte-identity is the acceptance
    // test for that. No RNG, so replays stay exact.
    const map = state.map;
    const seen = new Set([y * map.width + x]);
    const queue = [{ x, y }];
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      let placed = false;
      for (const { dx, dy } of DIRS8) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const key = ny * map.width + nx;
        if (seen.has(key)) continue;
        seen.add(key);
        const t = tileAt(map, nx, ny);
        if (t === TILE.WALL) continue; // never queue through rock
        if (free(nx, ny)) {
          dropX = nx;
          dropY = ny;
          placed = true;
          break;
        }
        queue.push({ x: nx, y: ny });
      }
      if (placed) break;
    }
  }
  const chest = createBossChest(state.rng, dropX, dropY);
  chest.id = allocId(state);
  state.items.push(chest);
}

// The Ring of Survival's moment: called wherever player HP would cross zero
// (enemy hits here in resolveAttack, chest traps in the turn engine). If the
// ring is armed, restore part of the health bar, consume it, and report true —
// the caller skips its death handling. A run can re-arm it by finding another
// Survival ring in a later band.
//
// It used to restore FULL HP, which made the cheated death cost nothing: you
// walked away from a lethal hit in better shape than most fights leave you.
// Half (rounded up, never less than 1) still saves the run and still feels
// like a reprieve, but leaves the player wounded enough to have to play for it.
export function tryRingSurvival(state, player, events) {
  if (!(player.ringSurvival ?? false)) return false;
  player.ringSurvival = false;
  player.hp = Math.max(1, Math.ceil(player.maxHp * SURVIVAL_HEAL_FRACTION));
  events.push(survivalEvent(player.x, player.y));
  pushLog(state, 'survival', {});
  return true;
}

// Player and enemies are the only two factions: a bump attacks only across the
// faction line (player↔enemy), never enemy↔enemy.
export function areHostile(a, b) {
  return (a.kind === 'player') !== (b.kind === 'player');
}

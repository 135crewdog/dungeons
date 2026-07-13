// Combat resolution. Pure with respect to the renderer: it mutates HP on the
// state and returns events describing what happened (hit/miss/death) so the
// renderer can float numbers. All randomness goes through the game RNG.

import { HIT_CHANCE } from '../core/constants.js';
import { chance, nextInt } from '../core/rng.js';
import { attackEvent, deathEvent } from '../core/events.js';
import { pushLog } from '../core/entity.js';

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

  if (!chance(state.rng, HIT_CHANCE)) {
    events.push(attackEvent(attackerId, targetId, false, 0, target.x, target.y));
    pushLog(state, 'miss', { attacker: attacker.kind, target: target.kind });
    return events;
  }

  // Enemies roll their damage die fresh on every landed hit (only after the
  // hit roll, so a miss costs one RNG draw and a landed hit costs two); the
  // player's damage is flat.
  const base = attacker.damageDie
    ? nextInt(state.rng, 1, attacker.damageDie) * (attacker.damageMult ?? 1)
    : attacker.damage;
  const raw = base + (attacker.strength ?? 0);
  const damage = mitigatedDamage(raw, target.armor ?? 0);
  target.hp -= damage;
  events.push(attackEvent(attackerId, targetId, true, damage, target.x, target.y));
  pushLog(state, 'hit', { attacker: attacker.kind, target: target.kind, damage });

  if (target.hp <= 0) {
    target.hp = 0;
    events.push(deathEvent(target.id, target.kind));
    pushLog(state, 'death', { kind: target.kind });
    if (target.id === state.entities.playerId) {
      // Keep the player entity in place for the game-over frame; stop the run.
      state.status = 'dead';
    } else {
      state.entities.byId.delete(target.id);
    }
  }
  return events;
}

// Player and enemies are the only two factions: a bump attacks only across the
// faction line (player↔enemy), never enemy↔enemy.
export function areHostile(a, b) {
  return (a.kind === 'player') !== (b.kind === 'player');
}

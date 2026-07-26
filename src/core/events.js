// The one-way channel from simulation to renderer. Turn actions return a list
// of these plain-data events; the renderer reads them to play transient effects
// (floating numbers, etc.) while redrawing durable state from the state object.
// The simulation never holds a renderer reference — it only returns events.

export const EV = Object.freeze({
  MOVE: 'move',
  ATTACK: 'attack',
  PICKUP: 'pickup',
  REVEAL: 'reveal',
  LOCKED: 'locked',
  SURVIVAL: 'survival',
  DESCEND: 'descend',
  ASCEND: 'ascend',
  DEATH: 'death',
});

export function moveEvent(id, from, to) {
  return { type: EV.MOVE, id, from, to };
}

// `roll` is the attacker's to-hit d20 result, so the UI can show the dice.
export function attackEvent(attackerId, targetId, hit, damage, x, y, roll = 0) {
  return { type: EV.ATTACK, attackerId, targetId, hit, damage, x, y, roll };
}

export function pickupEvent(
  itemId,
  x,
  y,
  { item = 'potion', heal = 0, effect = null, amount = 0 } = {},
) {
  return { type: EV.PICKUP, itemId, x, y, item, heal, effect, amount };
}

// A hidden key blinked into view (the proximity reveal).
export function revealEvent(itemId, x, y) {
  return { type: EV.REVEAL, itemId, x, y };
}

// The player stood on a locked chest with no key to spend.
export function lockedEvent(x, y) {
  return { type: EV.LOCKED, x, y };
}

// The Ring of Survival fired: death averted, ring consumed.
export function survivalEvent(x, y) {
  return { type: EV.SURVIVAL, x, y };
}

export function descendEvent(floor) {
  return { type: EV.DESCEND, floor };
}

export function ascendEvent(floor) {
  return { type: EV.ASCEND, floor };
}

export function deathEvent(id, kind) {
  return { type: EV.DEATH, id, kind };
}

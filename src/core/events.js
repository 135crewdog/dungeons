// The one-way channel from simulation to renderer. Turn actions return a list
// of these plain-data events; the renderer reads them to play transient effects
// (floating numbers, etc.) while redrawing durable state from the state object.
// The simulation never holds a renderer reference — it only returns events.

export const EV = Object.freeze({
  MOVE: 'move',
  ATTACK: 'attack',
  PICKUP: 'pickup',
  DESCEND: 'descend',
  ASCEND: 'ascend',
  DEATH: 'death',
});

export function moveEvent(id, from, to) {
  return { type: EV.MOVE, id, from, to };
}

export function attackEvent(attackerId, targetId, hit, damage, x, y) {
  return { type: EV.ATTACK, attackerId, targetId, hit, damage, x, y };
}

export function pickupEvent(itemId, x, y, heal) {
  return { type: EV.PICKUP, itemId, x, y, heal };
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

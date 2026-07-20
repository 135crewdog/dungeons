// Renderer-local left/right facing, derived from a turn's event list. The
// sim has no facing concept — this is purely visual, like door-open art.
// Sheets face right natively; a facing of -1 means "mirror the frame".
// Moving left or right turns the mover; vertical moves keep the last facing;
// attacking turns the attacker toward its target (bump-attacks emit no MOVE).

import { EV } from '../core/events.js';

// Mutates `facing` (Map: entity id → 1 right | -1 left; absent = right) from
// the events of one turn. `getX(id)` supplies an entity's current x from
// state (read-only); it returns undefined for ids no longer alive, which
// skips the update. Attack events carry the target's tile as ev.x/ev.y, and
// an attacker never moves in its attacking turn, so post-turn x is its
// position at swing time.
export function applyEventFacing(facing, events, getX) {
  for (const ev of events) {
    if (ev.type === EV.MOVE) {
      const dx = ev.to.x - ev.from.x;
      if (dx !== 0) facing.set(ev.id, dx > 0 ? 1 : -1);
    } else if (ev.type === EV.ATTACK) {
      const ax = getX(ev.attackerId);
      if (ax === undefined) continue;
      const dx = ev.x - ax;
      if (dx !== 0) facing.set(ev.attackerId, dx > 0 ? 1 : -1);
    }
  }
}

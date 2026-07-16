// Bridges shadowcasting to the game state each turn: recompute currently-visible
// tiles, accumulate the explored (remembered) set, and reveal a whole room on
// entry. Visibility blocks on walls but not on open doors.

import { computeFov } from './fov.js';
import { getPlayer, idx, inBounds, isTransparent } from '../core/query.js';

// Recompute state.vis for the current player position. `visible` is rebuilt
// from scratch each call; `explored` only ever grows (memory is monotonic).
export function updateVisibility(state) {
  const map = state.map;
  const { visible, explored } = state.vis;
  visible.fill(0);

  const player = getPlayer(state);
  if (!player) return;

  const isBlocking = (x, y) => !inBounds(map, x, y) || !isTransparent(map, x, y);
  const mark = (x, y) => {
    if (!inBounds(map, x, y)) return;
    const i = idx(map, x, y);
    visible[i] = 1;
    explored[i] = 1;
  };

  // max(width, height) makes line of sight effectively unbounded within walls.
  computeFov(player.x, player.y, isBlocking, mark, Math.max(map.width, map.height));

  revealRoom(state, player.x, player.y);
}

// On entering a room, mark the whole room (and its enclosing wall ring)
// explored, so its layout is remembered immediately. This only affects memory;
// what is currently lit stays shadowcast-driven. Explored memory is monotonic,
// so once a room is bulk-revealed there is nothing to redo while the player
// stays in it — `_revealedRoom` skips the double loop until the room changes.
function revealRoom(state, px, py) {
  const map = state.map;
  const rid = map.roomAt[idx(map, px, py)];
  if (rid === -1) return;
  if (state.vis._revealedRoom === rid) return;
  state.vis._revealedRoom = rid;
  const room = map.rooms[rid];
  for (let y = room.y - 1; y <= room.y + room.h; y++) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      if (inBounds(map, x, y)) state.vis.explored[idx(map, x, y)] = 1;
    }
  }
}

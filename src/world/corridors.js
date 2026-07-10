// Corridor carving + door placement. Connects rooms with 1-wide L-shaped
// tunnels. Where a tunnel breaches a room's perimeter wall, that boundary tile
// becomes a door ('+') — walkable and transparent (doors are open in Phase 1).

import { nextInt } from '../core/rng.js';
import { idx, inBounds } from '../core/query.js';
import { TILE, DIRS4 } from '../core/constants.js';
import { roomCenter } from './rooms.js';

// Ordered tiles of an L-path from (x1,y1) to (x2,y2), inclusive of the end.
function lPath(x1, y1, x2, y2, horizontalFirst) {
  const pts = [];
  const sx = Math.sign(x2 - x1);
  const sy = Math.sign(y2 - y1);
  if (horizontalFirst) {
    for (let x = x1; x !== x2; x += sx) pts.push({ x, y: y1 });
    for (let y = y1; y !== y2; y += sy) pts.push({ x: x2, y });
  } else {
    for (let y = y1; y !== y2; y += sy) pts.push({ x: x1, y });
    for (let x = x1; x !== x2; x += sx) pts.push({ x, y: y2 });
  }
  pts.push({ x: x2, y: y2 });
  return pts;
}

// A wall tile that touches a room interior — i.e., carving it opens the room.
function breachesRoom(map, x, y) {
  for (const { dx, dy } of DIRS4) {
    const nx = x + dx;
    const ny = y + dy;
    if (inBounds(map, nx, ny) && map.roomAt[idx(map, nx, ny)] !== -1) return true;
  }
  return false;
}

function carvePath(map, pts) {
  for (const { x, y } of pts) {
    const i = idx(map, x, y);
    if (map.tiles[i] === TILE.WALL) {
      map.tiles[i] = breachesRoom(map, x, y) ? TILE.DOOR : TILE.FLOOR;
    }
    // Existing FLOOR / DOOR / STAIRS tiles are left untouched.
  }
}

function connect(map, rng, a, b) {
  const ca = roomCenter(a);
  const cb = roomCenter(b);
  const horizontalFirst = nextInt(rng, 0, 1) === 0;
  carvePath(map, lPath(ca.x, ca.y, cb.x, cb.y, horizontalFirst));
}

// Connect all rooms. A spanning path in placement order guarantees the whole
// floor is reachable; a few extra links add loops so topology varies per floor.
export function connectRooms(map, rng, rooms) {
  if (rooms.length < 2) return;
  for (let i = 1; i < rooms.length; i++) {
    connect(map, rng, rooms[i - 1], rooms[i]);
  }
  const extra = nextInt(rng, 0, Math.max(1, Math.floor(rooms.length / 3)));
  for (let e = 0; e < extra; e++) {
    const a = rooms[nextInt(rng, 0, rooms.length - 1)];
    const b = rooms[nextInt(rng, 0, rooms.length - 1)];
    if (a.id !== b.id) connect(map, rng, a, b);
  }
}

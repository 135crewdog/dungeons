// Corridor carving + door placement. Rooms are linked by a minimum spanning
// tree over their centers (plus a few short extra links for loops), so every
// corridor runs between *nearby* rooms and halls stay short. Aligned rooms get a
// straight tunnel; others get a single L-bend. Carving happens in two passes:
// first every corridor tile is cut as FLOOR, then a doorway pass turns the
// one-tile-wide breaches in room walls into doors ('+'). A door is only ever a
// genuine perpendicular gateway — a corridor grazing a wall never becomes a row
// of doors.

import { nextInt } from '../core/rng.js';
import { idx, inBounds } from '../core/query.js';
import { TILE } from '../core/constants.js';
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

// Cut a single tile to FLOOR if it is currently solid wall. Room interiors,
// existing corridors, doors, and stairs are left untouched.
function carveFloor(map, x, y) {
  const i = idx(map, x, y);
  if (map.tiles[i] === TILE.WALL) map.tiles[i] = TILE.FLOOR;
}

// Overlap of two inclusive integer ranges, or null if they don't overlap.
function rangeOverlap(a0, a1, b0, b1) {
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  return lo <= hi ? [lo, hi] : null;
}

// Carve a corridor between two rooms. If their interiors share a column, run a
// straight vertical tunnel through it; if they share a row, a straight
// horizontal one; otherwise bend once between the two centers. Rooms never
// overlap, so a shared column implies vertical separation (and vice versa).
function tunnel(map, rng, a, b) {
  const xo = rangeOverlap(a.x, a.x + a.w - 1, b.x, b.x + b.w - 1);
  const yo = rangeOverlap(a.y, a.y + a.h - 1, b.y, b.y + b.h - 1);
  if (xo) {
    const cx = nextInt(rng, xo[0], xo[1]);
    const [top, bot] = a.y < b.y ? [a, b] : [b, a];
    for (let y = top.y + top.h; y <= bot.y - 1; y++) carveFloor(map, cx, y);
  } else if (yo) {
    const cy = nextInt(rng, yo[0], yo[1]);
    const [left, right] = a.x < b.x ? [a, b] : [b, a];
    for (let x = left.x + left.w; x <= right.x - 1; x++) carveFloor(map, x, cy);
  } else {
    const ca = roomCenter(a);
    const cb = roomCenter(b);
    const horizontalFirst = nextInt(rng, 0, 1) === 0;
    for (const { x, y } of lPath(ca.x, ca.y, cb.x, cb.y, horizontalFirst)) {
      carveFloor(map, x, y);
    }
  }
}

// Solid to sight/passage: out of bounds, or a wall tile.
function isSolid(map, x, y) {
  return !inBounds(map, x, y) || map.tiles[idx(map, x, y)] === TILE.WALL;
}

// A room interior tile (carved floor that belongs to a room).
function isRoomInterior(map, x, y) {
  return inBounds(map, x, y) && map.roomAt[idx(map, x, y)] !== -1;
}

// Is this corridor tile a genuine doorway? It must be a one-tile-wide breach in
// a room wall: a room interior on one side, with solid wall on both flanks
// perpendicular to that side (so it is a gateway, not a corridor running
// alongside — or straight through a gap in — the wall).
function isDoorway(map, x, y) {
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    if (!isRoomInterior(map, x + dx, y + dy)) continue;
    // Flanks are the two tiles perpendicular to the room direction.
    const px = dy;
    const py = dx;
    if (isSolid(map, x + px, y + py) && isSolid(map, x - px, y - py)) return true;
  }
  return false;
}

// Turn every qualifying corridor tile into a door. Room interiors (roomAt set)
// are skipped, so only corridor-carved tiles on a wall boundary can become doors.
function placeDoors(map) {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = idx(map, x, y);
      if (map.tiles[i] !== TILE.FLOOR || map.roomAt[i] !== -1) continue;
      if (isDoorway(map, x, y)) map.tiles[i] = TILE.DOOR;
    }
  }
}

// Safety net: if two doors ever end up orthogonally adjacent, keep one and drop
// the other to plain floor — a room may never present a row of doors.
function collapseAdjacentDoors(map) {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = idx(map, x, y);
      if (map.tiles[i] !== TILE.DOOR) continue;
      if (x + 1 < map.width && map.tiles[i + 1] === TILE.DOOR) {
        map.tiles[i + 1] = TILE.FLOOR;
      }
      if (y + 1 < map.height && map.tiles[i + map.width] === TILE.DOOR) {
        map.tiles[i + map.width] = TILE.FLOOR;
      }
    }
  }
}

// Manhattan distance between two rooms' centers.
function roomDist(a, b) {
  const ca = roomCenter(a);
  const cb = roomCenter(b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}

// Connect all rooms. A minimum spanning tree (Kruskal over room-center
// distances) guarantees full reachability with the shortest total corridor
// length; a few of the next-shortest links are added for loops so topology
// varies per floor. Doors are placed after all carving so the two passes see the
// finished corridor layout.
export function connectRooms(map, rng, rooms) {
  if (rooms.length < 2) return;

  const edges = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      edges.push({ i, j, d: roomDist(rooms[i], rooms[j]) });
    }
  }
  edges.sort((p, q) => p.d - q.d || p.i - q.i || p.j - q.j);

  const parent = rooms.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const treeEdges = [];
  const extraEdges = []; // non-tree links, shortest first
  for (const e of edges) {
    const ra = find(e.i);
    const rb = find(e.j);
    if (ra !== rb) {
      parent[ra] = rb;
      treeEdges.push(e);
    } else {
      extraEdges.push(e);
    }
  }

  for (const e of treeEdges) tunnel(map, rng, rooms[e.i], rooms[e.j]);

  const extra = nextInt(rng, 0, Math.max(1, Math.floor(rooms.length / 3)));
  for (let k = 0; k < extra && k < extraEdges.length; k++) {
    const e = extraEdges[k];
    tunnel(map, rng, rooms[e.i], rooms[e.j]);
  }

  placeDoors(map);
  collapseAdjacentDoors(map);
}

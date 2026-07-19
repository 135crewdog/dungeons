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
import {
  TILE,
  LOOP_MIN_GRAPH_DIST,
  LOOP_MAX_ROOM_DEGREE,
  LOOP_MAX_LENGTH_FACTOR,
  CONNECT_ADJACENT_ROOMS,
  ADJACENT_ROOM_MIN_GRAPH_DIST,
} from '../core/constants.js';
import { roomCenter } from './rooms.js';

// Clamp v into the inclusive [lo, hi] range.
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

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

// Carve a corridor between two rooms. Routing is fully deterministic (no RNG),
// so repeated corridors between aligned rooms coincide instead of scattering
// one tile apart into a double-wide hall. If their interiors share a column,
// run a straight vertical tunnel through the column nearest both centers; if
// they share a row, a straight horizontal one; otherwise a single L-bend that
// travels the longer axis first, so the elbow reads as one clean corner. Rooms
// never overlap, so a shared column implies vertical separation (and vice versa).
function tunnel(map, a, b) {
  const ca = roomCenter(a);
  const cb = roomCenter(b);
  const xo = rangeOverlap(a.x, a.x + a.w - 1, b.x, b.x + b.w - 1);
  const yo = rangeOverlap(a.y, a.y + a.h - 1, b.y, b.y + b.h - 1);
  if (xo) {
    const cx = clamp(Math.round((ca.x + cb.x) / 2), xo[0], xo[1]);
    const [top, bot] = a.y < b.y ? [a, b] : [b, a];
    for (let y = top.y + top.h; y <= bot.y - 1; y++) carveFloor(map, cx, y);
  } else if (yo) {
    const cy = clamp(Math.round((ca.y + cb.y) / 2), yo[0], yo[1]);
    const [left, right] = a.x < b.x ? [a, b] : [b, a];
    for (let x = left.x + left.w; x <= right.x - 1; x++) carveFloor(map, x, cy);
  } else {
    const horizontalFirst = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y);
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

// Hop count between two rooms over the current corridor graph (BFS), or
// Infinity if they are not yet connected through it. Used to keep loop edges
// meaningful: a redundant triangle side is only 2 hops apart, a real shortcut
// is farther.
function graphDist(adj, src, dst) {
  if (src === dst) return 0;
  const dist = new Map([[src, 0]]);
  const queue = [src];
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    const du = dist.get(u);
    for (const v of adj[u]) {
      if (dist.has(v)) continue;
      if (v === dst) return du + 1;
      dist.set(v, du + 1);
      queue.push(v);
    }
  }
  return Infinity;
}

// Median corridor length over the tree edges, for the loop-length cap.
function medianTreeLength(treeEdges) {
  if (treeEdges.length === 0) return 0;
  const lens = treeEdges.map((e) => e.d).sort((a, b) => a - b);
  const mid = lens.length >> 1;
  return lens.length % 2 ? lens[mid] : (lens[mid - 1] + lens[mid]) / 2;
}

// The single wall tile to punch as a door between two rooms that sit exactly one
// wall apart with overlapping columns (or rows), or null if they are not so
// aligned. `horizontal` records which flanks must stay solid for a clean door.
function adjacentDoorTile(a, b) {
  const xo = rangeOverlap(a.x, a.x + a.w - 1, b.x, b.x + b.w - 1);
  if (xo) {
    const [top, bot] = a.y < b.y ? [a, b] : [b, a];
    if (bot.y - (top.y + top.h) === 1) {
      const ca = roomCenter(a);
      const cb = roomCenter(b);
      const x = clamp(Math.round((ca.x + cb.x) / 2), xo[0], xo[1]);
      return { x, y: top.y + top.h, horizontal: true };
    }
  }
  const yo = rangeOverlap(a.y, a.y + a.h - 1, b.y, b.y + b.h - 1);
  if (yo) {
    const [left, right] = a.x < b.x ? [a, b] : [b, a];
    if (right.x - (left.x + left.w) === 1) {
      const ca = roomCenter(a);
      const cb = roomCenter(b);
      const y = clamp(Math.round((ca.y + cb.y) / 2), yo[0], yo[1]);
      return { x: left.x + left.w, y, horizontal: false };
    }
  }
  return null;
}

// Link rooms that physically abut (one wall apart) but are far apart in the
// corridor graph, by punching a single clean door through the dividing wall.
// Only carves when the target tile is wall and both flanks are solid, so the
// doorway pass turns it into exactly one door (never a wide opening).
function connectAdjacentRooms(map, rooms, adj) {
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (graphDist(adj, i, j) < ADJACENT_ROOM_MIN_GRAPH_DIST) continue;
      const door = adjacentDoorTile(rooms[i], rooms[j]);
      if (!door) continue;
      if (map.tiles[idx(map, door.x, door.y)] !== TILE.WALL) continue;
      const flanks = door.horizontal
        ? [
            [-1, 0],
            [1, 0],
          ]
        : [
            [0, -1],
            [0, 1],
          ];
      if (!flanks.every(([dx, dy]) => isSolid(map, door.x + dx, door.y + dy))) continue;
      carveFloor(map, door.x, door.y);
      adj[i].push(j);
      adj[j].push(i);
    }
  }
}

// Connect all rooms. A minimum spanning tree (Kruskal over room-center
// distances) guarantees full reachability with the shortest total corridor
// length. A few loop corridors are then added for alternate routes, but only
// ones that are genuine shortcuts (endpoints far apart in the graph, not piling
// onto a hub room, not a second cross-map haul) so loops never run parallel to
// an existing hall. Physically-adjacent rooms are finally linked by a door.
// Doors are placed after all carving so the two passes see the finished layout.
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

  for (const e of treeEdges) tunnel(map, rooms[e.i], rooms[e.j]);

  // Loop corridors: keep the same budget draw, but only carve edges that are
  // real shortcuts, so loops add topology without parallel/double-wide halls.
  const adj = rooms.map(() => []);
  const degree = rooms.map(() => 0);
  for (const e of treeEdges) {
    adj[e.i].push(e.j);
    adj[e.j].push(e.i);
    degree[e.i]++;
    degree[e.j]++;
  }
  const maxLoopLen = medianTreeLength(treeEdges) * LOOP_MAX_LENGTH_FACTOR;
  const loopBudget = nextInt(rng, 0, Math.max(1, Math.floor(rooms.length / 3)));
  let added = 0;
  for (const e of extraEdges) {
    if (added >= loopBudget) break;
    if (e.d > maxLoopLen) continue;
    if (degree[e.i] >= LOOP_MAX_ROOM_DEGREE || degree[e.j] >= LOOP_MAX_ROOM_DEGREE) continue;
    if (graphDist(adj, e.i, e.j) < LOOP_MIN_GRAPH_DIST) continue;
    tunnel(map, rooms[e.i], rooms[e.j]);
    adj[e.i].push(e.j);
    adj[e.j].push(e.i);
    degree[e.i]++;
    degree[e.j]++;
    added++;
  }

  if (CONNECT_ADJACENT_ROOMS) connectAdjacentRooms(map, rooms, adj);

  placeDoors(map);
  collapseAdjacentDoors(map);
}

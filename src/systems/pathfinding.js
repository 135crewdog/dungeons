// 8-directional A* over an abstract passability predicate. Pure and reusable:
// the enemy AI and the click-to-move planner supply different `passable`
// functions but share this one implementation. Costs are integers (10 cardinal,
// 14 diagonal) and the open set is a binary heap tie-broken by node id, so the
// same inputs always yield the same path (determinism).

import { DIRS8 } from '../core/constants.js';
import { diagonalAllowed } from '../core/query.js';

function octile(dx, dy) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return 10 * Math.abs(ax - ay) + 14 * Math.min(ax, ay);
}

// Ordering: lower f first, then lower h, then lower node id.
function before(a, b) {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  return a.id < b.id;
}

class MinHeap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (before(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      for (;;) {
        let s = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < n && before(a[l], a[s])) s = l;
        if (r < n && before(a[r], a[s])) s = r;
        if (s === i) break;
        [a[i], a[s]] = [a[s], a[i]];
        i = s;
      }
    }
    return top;
  }
}

// Find a path from start to goal (inclusive of both), or null if unreachable.
// `passable(x, y)` decides whether a tile can be entered; the goal must itself
// be passable. A diagonal step is forbidden if either orthogonal between it and
// the current tile is impassable (no corner-cutting).
export function aStar(passable, start, goal, width) {
  if (start.x === goal.x && start.y === goal.y) return [{ x: start.x, y: start.y }];

  const startId = start.y * width + start.x;
  const goalId = goal.y * width + goal.x;
  const open = new MinHeap();
  const gScore = new Map([[startId, 0]]);
  const cameFrom = new Map();
  const closed = new Set();

  const h0 = octile(start.x - goal.x, start.y - goal.y);
  open.push({ id: startId, x: start.x, y: start.y, g: 0, f: h0, h: h0 });

  while (open.size) {
    const cur = open.pop();
    if (cur.id === goalId) return reconstruct(cameFrom, goalId, startId, width);
    if (closed.has(cur.id)) continue;
    closed.add(cur.id);
    if (cur.g !== gScore.get(cur.id)) continue; // stale heap entry

    for (const { dx, dy } of DIRS8) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const nid = ny * width + nx;
      if (closed.has(nid)) continue;
      if (!passable(nx, ny)) continue;
      if (!diagonalAllowed(passable, cur.x, cur.y, dx, dy)) continue;
      const ng = cur.g + (dx !== 0 && dy !== 0 ? 14 : 10);
      if (gScore.has(nid) && ng >= gScore.get(nid)) continue;
      gScore.set(nid, ng);
      cameFrom.set(nid, cur.id);
      const hh = octile(nx - goal.x, ny - goal.y);
      open.push({ id: nid, x: nx, y: ny, g: ng, f: ng + hh, h: hh });
    }
  }
  return null;
}

function reconstruct(cameFrom, goalId, startId, width) {
  const path = [];
  let id = goalId;
  while (id !== startId) {
    path.push({ x: id % width, y: Math.floor(id / width) });
    id = cameFrom.get(id);
    if (id === undefined) return null;
  }
  path.push({ x: startId % width, y: Math.floor(startId / width) });
  path.reverse();
  return path;
}

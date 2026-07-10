// Symmetric shadowcasting (Albert Ford's algorithm). Pure and Phaser-free:
// given an origin, an `isBlocking(x, y)` predicate, and a `mark(x, y)` callback,
// it marks every tile with line of sight from the origin. Symmetric means
// A sees B if and only if B sees A. Slopes are exact rationals ({ n, d }, d > 0)
// so no floating-point rounding can break that symmetry.

// Local (depth, col) → map (x, y) for each of the four quadrants.
function transform(cardinal, ox, oy, depth, col) {
  switch (cardinal) {
    case 0: return { x: ox + col, y: oy - depth }; // North
    case 1: return { x: ox + depth, y: oy + col }; // East
    case 2: return { x: ox + col, y: oy + depth }; // South
    default: return { x: ox - depth, y: oy + col }; // West
  }
}

// Slope of a tile edge as an exact rational.
function slope(depth, col) {
  return { n: 2 * col - 1, d: 2 * depth };
}

// floor(depth * s + 1/2), computed exactly with integers (s.d > 0).
function roundTiesUp(depth, s) {
  return Math.floor((2 * depth * s.n + s.d) / (2 * s.d));
}

// ceil(depth * s - 1/2), computed exactly with integers (s.d > 0).
function roundTiesDown(depth, s) {
  return Math.ceil((2 * depth * s.n - s.d) / (2 * s.d));
}

// col within [depth*start, depth*end], via cross-multiplication (d > 0).
function isSymmetric(depth, col, start, end) {
  return col * start.d >= depth * start.n && col * end.d <= depth * end.n;
}

export function computeFov(ox, oy, isBlocking, mark, maxDepth) {
  mark(ox, oy);
  for (let cardinal = 0; cardinal < 4; cardinal++) {
    const stack = [{ depth: 1, start: { n: -1, d: 1 }, end: { n: 1, d: 1 } }];
    while (stack.length) {
      const row = stack.pop();
      const { depth } = row;
      if (depth > maxDepth) continue;

      const minCol = roundTiesUp(depth, row.start);
      const maxCol = roundTiesDown(depth, row.end);
      let prevBlocking = null; // null = no previous tile in this row
      let startSlope = row.start;

      for (let col = minCol; col <= maxCol; col++) {
        const { x, y } = transform(cardinal, ox, oy, depth, col);
        const wall = isBlocking(x, y);

        if (wall || isSymmetric(depth, col, startSlope, row.end)) {
          mark(x, y);
        }
        if (prevBlocking === true && !wall) {
          startSlope = slope(depth, col);
        }
        if (prevBlocking === false && wall) {
          stack.push({ depth: depth + 1, start: startSlope, end: slope(depth, col) });
        }
        prevBlocking = wall;
      }
      if (prevBlocking === false) {
        stack.push({ depth: depth + 1, start: startSlope, end: row.end });
      }
    }
  }
}

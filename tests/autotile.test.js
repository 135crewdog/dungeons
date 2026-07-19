import { describe, it, expect } from 'vitest';
import { F, NO_FRAME, variance, groundFrame, wallsFrame } from '../src/renderer/autotile.js';
import { TILE } from '../src/core/constants.js';

// Build a map from ASCII art rows: '#' wall, '.' floor, '+' door,
// '>' stairs down, '<' stairs up. Same shape as the real map object.
const CHAR_TILE = {
  '#': TILE.WALL,
  '.': TILE.FLOOR,
  '+': TILE.DOOR,
  '>': TILE.STAIRS_DOWN,
  '<': TILE.STAIRS_UP,
};

function mapOf(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const tiles = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles[y * width + x] = CHAR_TILE[rows[y][x]];
    }
  }
  return { width, height, tiles };
}

// Ground frames vary by cell hash; strip a wall front face back to its base
// (plain, alt, or door-backing) plus its edge bits for variance-proof asserts.
const SALT = 1;
const open = () => true;

describe('variance', () => {
  it('is deterministic and in range', () => {
    for (const [x, y, salt] of [
      [0, 0, 0],
      [7, 3, 1],
      [71, 43, 12],
    ]) {
      const v = variance(x, y, salt);
      expect(v).toBe(variance(x, y, salt));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(100);
    }
  });

  it('splits roughly 50/45/5 across many cells', () => {
    let base = 0;
    let common = 0;
    let rare = 0;
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        const v = variance(x, y, 3);
        if (v >= 95) rare++;
        else if (v >= 50) common++;
        else base++;
      }
    }
    expect(base).toBeGreaterThan(4500);
    expect(base).toBeLessThan(5500);
    expect(common).toBeGreaterThan(4000);
    expect(common).toBeLessThan(5000);
    expect(rare).toBeGreaterThan(300);
    expect(rare).toBeLessThan(700);
  });

  it('differs between floors (salt)', () => {
    const a = [];
    const b = [];
    for (let i = 0; i < 50; i++) {
      a.push(variance(i, 0, 1));
      b.push(variance(i, 0, 2));
    }
    expect(a).not.toEqual(b);
  });
});

describe('floor, stairs, and solid rock', () => {
  const m = mapOf([
    '#####', //
    '#.><#',
    '#####',
  ]);

  it('floor picks the variant its hash dictates', () => {
    const v = variance(1, 1, SALT);
    const want = v >= 95 ? F.FLOOR_ALT2 : v >= 50 ? F.FLOOR_ALT1 : F.FLOOR;
    expect(groundFrame(m, 1, 1, SALT)).toBe(want);
  });

  it('stairs use the entrance/exit frames', () => {
    expect(groundFrame(m, 2, 1, SALT)).toBe(F.STAIRS_DOWN);
    expect(groundFrame(m, 3, 1, SALT)).toBe(F.STAIRS_UP);
  });

  it('solid rock draws a mask-0 wall top and no ground', () => {
    const rock = mapOf(['###', '###', '###']);
    expect(wallsFrame(rock, 1, 1)).toBe(F.WALL_INTERNAL);
    expect(groundFrame(rock, 1, 1, SALT)).toBe(NO_FRAME);
  });

  it('treats out-of-bounds as wall on every border', () => {
    const rock = mapOf(['###', '###', '###']);
    for (const [x, y] of [
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
      [1, 0],
      [0, 1],
    ]) {
      expect(wallsFrame(rock, x, y)).toBe(F.WALL_INTERNAL);
      expect(groundFrame(rock, x, y, SALT)).toBe(NO_FRAME);
    }
  });
});

describe('wall front faces and overhangs (horizontal wall over floor)', () => {
  // A room: the wall row above floor shows front faces; the floor row
  // directly *above* that wall row (inside the top rock) — none; the floor
  // cells under the bottom wall get that wall's overhang.
  const m = mapOf([
    '#####', //
    '#...#',
    '#####',
  ]);

  it('wall with floor below draws a front face with edge bits', () => {
    // (2,0): below floor, walls both sides -> plain/alt base, no bits.
    const mid = groundFrame(m, 2, 0, SALT);
    const midBase = variance(2, 0, SALT) >= 50 ? F.RAISED_WALL_ALT : F.RAISED_WALL;
    expect(mid).toBe(midBase);
    // Corner walls (0,0)/(4,0) sit over rock columns: below is wall -> no face.
    expect(groundFrame(m, 0, 0, SALT)).toBe(NO_FRAME);
    // Their tops come from the walls layer instead; along the wall row the
    // cardinal neighbors are walls, so only the below-diagonal opens a bit.
    expect(wallsFrame(m, 0, 0)).toBe(F.WALL_INTERNAL + 2); // open below-right
    expect(wallsFrame(m, 4, 0)).toBe(F.WALL_INTERNAL + 4); // open below-left
  });

  it('front-face row has no walls-layer art; floor above bottom wall gets the overhang', () => {
    expect(wallsFrame(m, 2, 0)).toBe(NO_FRAME); // face cell: nothing on top
    // Floor (2,1) sits on the bottom wall (2,2): overhang, both diagonals wall.
    expect(wallsFrame(m, 2, 1)).toBe(F.WALL_OVERHANG);
    // Floor (1,1): below-left diagonal (0,2) is wall, below-right (2,2) wall too.
    expect(wallsFrame(m, 1, 1)).toBe(F.WALL_OVERHANG);
  });

  it('bottom wall row draws internal tops (below is out of bounds = wall)', () => {
    expect(wallsFrame(m, 2, 2)).toBe(F.WALL_INTERNAL); // rock below, walls l/r
  });
});

describe('corners, junctions, and stubs (wall-top stitch masks)', () => {
  it('stitches an L-corner', () => {
    // Wall block in the top-left, floor filling the L around it.
    const m = mapOf([
      '##..', //
      '##..',
      '....',
    ]);
    // (1,0): right open (+1), below-right (2,1) open (+2), below-left (0,1)
    // wall, left wall.
    expect(wallsFrame(m, 1, 0)).toBe(F.WALL_INTERNAL + 1 + 2);
    // (0,1) has floor below -> front face, not a top; its right neighbor
    // (1,1) is still wall and the left edge is out of bounds, so no bits.
    const base = variance(0, 1, SALT) >= 50 ? F.RAISED_WALL_ALT : F.RAISED_WALL;
    expect(groundFrame(m, 0, 1, SALT)).toBe(base);
  });

  it('stitches a T-junction', () => {
    // A wall spine with a stem hanging down into floor.
    const m = mapOf([
      '#####', //
      '..#..',
      '..#..',
    ]);
    // Spine cell above the stem (2,0): below is wall -> internal top; right
    // and left along the spine are walls, both below-diagonals are floor.
    expect(wallsFrame(m, 2, 0)).toBe(F.WALL_INTERNAL + 2 + 4);
    // Stem cell (2,1): below wall -> top with left+right open.
    expect(wallsFrame(m, 2, 1)).toBe(F.WALL_INTERNAL + 1 + 2 + 4 + 8);
  });

  it('a 1-wide vertical stub is fully open at the sides', () => {
    const m = mapOf([
      '.#.', //
      '.#.',
      '...',
    ]);
    expect(wallsFrame(m, 1, 0)).toBe(F.WALL_INTERNAL + 1 + 2 + 4 + 8); // 159
    // Stub bottom (1,1): floor below -> front face with both side bits.
    const base = variance(1, 1, SALT) >= 50 ? F.RAISED_WALL_ALT : F.RAISED_WALL;
    expect(groundFrame(m, 1, 1, SALT)).toBe(base + 1 + 2);
    // The floor cells flanking the stub bottom see the rock diagonal only.
    expect(wallsFrame(m, 0, 0)).toBe(NO_FRAME); // below (0,1) is floor
  });
});

describe('raised doors (walls left/right, passage runs north-south)', () => {
  const m = mapOf([
    '#.#', //
    '#+#',
    '#.#',
  ]);

  it('draws the door face, open when occupied', () => {
    expect(groundFrame(m, 1, 1, SALT)).toBe(F.RAISED_DOOR);
    expect(groundFrame(m, 1, 1, SALT, open)).toBe(F.RAISED_DOOR_OPEN);
  });

  it('the cell above the door carries the door overhang', () => {
    expect(wallsFrame(m, 1, 0)).toBe(F.DOOR_OVERHANG);
    expect(wallsFrame(m, 1, 0, open)).toBe(F.DOOR_OVERHANG_OPEN);
  });

  it('flanking walls treat the door as open ground for their bits', () => {
    // (0,0) wall: below (0,1) is wall -> internal top; right (1,0) floor open
    // (+1), below-right (1,1) is the door: open (+2).
    expect(wallsFrame(m, 0, 0)).toBe(F.WALL_INTERNAL + 1 + 2);
    // (0,1) wall has floor below at (0,2)? No — (0,2) is wall; internal top.
    expect(wallsFrame(m, 0, 1)).toBe(F.WALL_INTERNAL + 1 + 2);
    // The door's own cell adds nothing in the walls layer.
    expect(wallsFrame(m, 1, 1)).toBe(NO_FRAME);
  });
});

describe('sideways doors (walls above/below, passage runs east-west)', () => {
  const m = mapOf([
    '###', //
    '.+.',
    '###',
  ]);

  it('ground shows floor under the doorway', () => {
    expect(groundFrame(m, 1, 1, SALT)).toBe(F.RAISED_DOOR_SIDEWAYS);
    expect(groundFrame(m, 1, 1, SALT, open)).toBe(F.RAISED_DOOR_SIDEWAYS);
  });

  it('the door cell draws its own top edge with below-diagonal bits', () => {
    // Below-diagonals (0,2)/(2,2) are wall -> no bits.
    expect(wallsFrame(m, 1, 1)).toBe(F.DOOR_SIDEWAYS_OVERHANG_CLOSED);
    expect(wallsFrame(m, 1, 1, open)).toBe(F.DOOR_SIDEWAYS_OVERHANG_OPEN);
  });

  it('the wall above shows the lintel until the door opens', () => {
    expect(wallsFrame(m, 1, 0)).toBe(F.DOOR_SIDEWAYS);
    expect(wallsFrame(m, 1, 0, open)).toBe(NO_FRAME);
  });

  it('the wall above uses the door-backing front face', () => {
    expect(groundFrame(m, 1, 0, SALT)).toBe(F.RAISED_WALL_DOOR); // walls l/r: no bits
  });

  it('open diagonals reach the sideways door top', () => {
    const m2 = mapOf([
      '###', //
      '.+.',
      '#.#', // below-right and below-left of nothing; door's diagonals: (0,2) wall, (2,2) wall
    ]);
    // Door (1,1): below (1,2) is floor, not wall -> raised-door rules apply
    // instead (no wall below). Ground: wall above -> sideways floor art.
    expect(groundFrame(m2, 1, 1, SALT)).toBe(F.RAISED_DOOR_SIDEWAYS);
    expect(wallsFrame(m2, 1, 1)).toBe(NO_FRAME);
  });
});

describe('walls next to stairs', () => {
  it('stairs are open ground to their neighbors', () => {
    const m = mapOf([
      '###', //
      '#>#',
      '###',
    ]);
    // Wall above the stairs draws a front face (stairs below = open).
    const base = variance(1, 0, SALT) >= 50 ? F.RAISED_WALL_ALT : F.RAISED_WALL;
    expect(groundFrame(m, 1, 0, SALT)).toBe(base); // walls both sides: no bits
    // The stairs cell receives the bottom wall's overhang.
    expect(wallsFrame(m, 1, 1)).toBe(F.WALL_OVERHANG);
  });
});

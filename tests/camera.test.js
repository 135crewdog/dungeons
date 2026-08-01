import { describe, it, expect } from 'vitest';
import {
  computeZoom,
  tileToWorld,
  tileCenterWorld,
  worldToTile,
  pickClickTile,
  CLICK_SNAP_PX,
} from '../src/renderer/camera.js';
import { TILE_SIZE } from '../src/core/constants.js';

// Walkability from ASCII rows: '#' is wall, everything else walkable. Out of
// bounds reads as wall, like the real isKnownWalkable does for unexplored.
function grid(rows) {
  return (x, y) => y >= 0 && y < rows.length && x >= 0 && x < rows[y].length && rows[y][x] !== '#';
}

// A one-tile-wide east-west corridor: walls at row 0 and row 2, floor at row 1.
const corridor = grid(['####', '....', '####']);

describe('tile <-> world pixel conversion', () => {
  it('round-trips a tile through its top-left and its center', () => {
    for (const [tx, ty] of [
      [0, 0],
      [3, 7],
      [71, 43],
    ]) {
      const tl = tileToWorld(tx, ty);
      const c = tileCenterWorld(tx, ty);
      expect(worldToTile(tl.x, tl.y)).toEqual({ x: tx, y: ty });
      expect(worldToTile(c.x, c.y)).toEqual({ x: tx, y: ty });
      expect(c.x - tl.x).toBe(TILE_SIZE / 2);
    }
  });

  it('floors rather than rounds, so a tile owns its whole cell', () => {
    expect(worldToTile(TILE_SIZE * 4, TILE_SIZE * 4)).toEqual({ x: 4, y: 4 });
    expect(worldToTile(TILE_SIZE * 5 - 1, TILE_SIZE * 5 - 1)).toEqual({ x: 4, y: 4 });
    expect(worldToTile(TILE_SIZE * 5, TILE_SIZE * 5)).toEqual({ x: 5, y: 5 });
  });

  it('picks an integer zoom that holds tiles near a constant CSS size', () => {
    expect(computeZoom(1)).toBe(2);
    expect(computeZoom(2)).toBe(4);
    expect(Number.isInteger(computeZoom(1.5))).toBe(true);
    expect(computeZoom(0)).toBeGreaterThanOrEqual(1); // never zero or negative
    expect(computeZoom(100)).toBeLessThanOrEqual(8); // clamped
  });
});

describe('pickClickTile (corridor click alignment)', () => {
  // The SPD wall art paints its top over the BOTTOM HALF of the open cell above
  // it, so a one-wide east-west corridor only shows its top half. The snap
  // gives the corridor back the wall pixels the eye already reads as corridor.
  const inCell = (t, frac) => t * TILE_SIZE + frac;

  it('leaves a click that already lands on a walkable tile untouched', () => {
    // This is what keeps rooms, items and enemies in the open behaving exactly
    // as before: the snap is only ever a second chance for a dead click.
    for (const frac of [0, 1, TILE_SIZE / 2, TILE_SIZE - 1]) {
      expect(pickClickTile(inCell(1, 4), inCell(1, frac), corridor)).toEqual({ x: 1, y: 1 });
    }
  });

  it('snaps down from the bottom half of the wall above a corridor', () => {
    expect(pickClickTile(inCell(1, 4), inCell(0, TILE_SIZE - CLICK_SNAP_PX), corridor)).toEqual({
      x: 1,
      y: 1,
    });
    expect(pickClickTile(inCell(1, 4), inCell(0, TILE_SIZE - 1), corridor)).toEqual({ x: 1, y: 1 });
  });

  it('does NOT snap from the top half of that same wall', () => {
    // One pixel above the boundary is still solid wall — the snap is half a
    // tile, not "any click near a corridor".
    const y = inCell(0, TILE_SIZE - CLICK_SNAP_PX - 1);
    expect(pickClickTile(inCell(1, 4), y, corridor)).toEqual({ x: 1, y: 0 });
    expect(pickClickTile(inCell(1, 4), inCell(0, 0), corridor)).toEqual({ x: 1, y: 0 });
  });

  it('never snaps a wall whose south neighbor is also wall', () => {
    // Row 2 is the wall BELOW the corridor; nothing walkable sits under it, so
    // clicking it stays a no-op rather than reaching two tiles up.
    expect(pickClickTile(inCell(1, 4), inCell(2, TILE_SIZE - 1), corridor)).toEqual({ x: 1, y: 2 });
    const solid = grid(['####', '####', '####']);
    expect(pickClickTile(inCell(1, 4), inCell(1, TILE_SIZE - 1), solid)).toEqual({ x: 1, y: 1 });
  });

  it('snaps only downward — the wall below a room never reaches up into it', () => {
    // Rows 0-1 are floor, row 2 is wall. A click low in the wall has no
    // walkable tile below it, so it stays put; the asymmetry is deliberate,
    // matching the art, which only ever crowds a tile from above.
    const room = grid(['....', '....', '####']);
    expect(pickClickTile(inCell(1, 4), inCell(2, TILE_SIZE - 1), room)).toEqual({ x: 1, y: 2 });
  });

  it('resolves an out-of-bounds click without snapping into the map', () => {
    expect(pickClickTile(-TILE_SIZE + 1, -1, corridor)).toEqual({ x: -1, y: -1 });
  });
});

describe('pickClickTile (sprite lift)', () => {
  // Character frames are drawn with their feet SPRITE_LIFT above the tile
  // bottom, so a frame taller than TILE_SIZE - SPRITE_LIFT pokes into the cell
  // ABOVE: 4px for the 12x15 humanoids, 7px for the 16x18 boss. Clicking those
  // pixels used to select the empty floor over the character's shoulder.
  const room = grid(['....', '....', '....']);
  const inCell = (t, frac) => t * TILE_SIZE + frac;
  // An enemy on (1,1) lifting `px` into the cell above it.
  const liftOn = (tx, ty, px) => (x, y) => (x === tx && y === ty ? px : 0);

  it('targets a humanoid whose head is drawn into the tile above', () => {
    const lift = liftOn(1, 1, 4);
    for (const frac of [TILE_SIZE - 4, TILE_SIZE - 1]) {
      expect(pickClickTile(inCell(1, 8), inCell(0, frac), room, lift)).toEqual({ x: 1, y: 1 });
    }
  });

  it('reaches further for the boss, which is drawn 7px up', () => {
    const lift = liftOn(1, 1, 7);
    expect(pickClickTile(inCell(1, 8), inCell(0, TILE_SIZE - 7), room, lift)).toEqual({
      x: 1,
      y: 1,
    });
    // ...but no further than its own frame: 8px up is the floor above it.
    expect(pickClickTile(inCell(1, 8), inCell(0, TILE_SIZE - 8), room, lift)).toEqual({
      x: 1,
      y: 0,
    });
  });

  it('leaves the click alone above the head band', () => {
    const lift = liftOn(1, 1, 4);
    // Deliberately walking onto the tile over an enemy still works from the
    // upper ~12px of that cell.
    expect(pickClickTile(inCell(1, 8), inCell(0, TILE_SIZE - 5), room, lift)).toEqual({
      x: 1,
      y: 0,
    });
    expect(pickClickTile(inCell(1, 8), inCell(0, 0), room, lift)).toEqual({ x: 1, y: 0 });
  });

  it('does nothing when the tile below is empty, or holds an unseen enemy', () => {
    // liftBelow returns 0 for an empty tile, the player, or an enemy out of
    // view — so those clicks resolve exactly as they did before 0.9.9.
    const none = () => 0;
    expect(pickClickTile(inCell(1, 8), inCell(0, TILE_SIZE - 1), room, none)).toEqual({
      x: 1,
      y: 0,
    });
  });

  it('is skipped entirely when no lift predicate is supplied', () => {
    expect(pickClickTile(inCell(1, 8), inCell(0, TILE_SIZE - 1), room)).toEqual({ x: 1, y: 0 });
  });

  it('still fires with the wall snap disabled (glyph terrain, sprite actors)', () => {
    // Terrain and creature sheets fall back independently: if only
    // tiles_prison.png fails, the map is glyphs but actors are still lifted
    // sprites, so the head band is real while the wall overhang is not.
    const lift = liftOn(1, 1, 4);
    expect(pickClickTile(inCell(1, 8), inCell(0, TILE_SIZE - 1), room, lift, 0)).toEqual({
      x: 1,
      y: 1,
    });
    // ...and with the wall snap off, a dead click on a wall stays dead.
    expect(pickClickTile(inCell(1, 4), inCell(0, TILE_SIZE - 1), corridor, () => 0, 0)).toEqual({
      x: 1,
      y: 0,
    });
  });

  it('degenerates to worldToTile with both corrections off', () => {
    // Full glyph mode: no lift, no overhang — every click resolves by plain
    // arithmetic, exactly as it did before either correction existed.
    for (const frac of [0, 4, 8, TILE_SIZE - 1]) {
      expect(pickClickTile(inCell(1, 4), inCell(0, frac), corridor, () => 0, 0)).toEqual(
        worldToTile(inCell(1, 4), inCell(0, frac)),
      );
    }
  });

  it('does not disturb the wall-overhang snap it runs ahead of', () => {
    // The corridor cases from 0.9.7, now with a lift predicate present but
    // reporting nothing: identical results.
    const none = () => 0;
    expect(pickClickTile(inCell(1, 4), inCell(0, TILE_SIZE - 1), corridor, none)).toEqual({
      x: 1,
      y: 1,
    });
    expect(pickClickTile(inCell(1, 4), inCell(0, 0), corridor, none)).toEqual({ x: 1, y: 0 });
    expect(pickClickTile(inCell(1, 4), inCell(1, 4), corridor, none)).toEqual({ x: 1, y: 1 });
  });
});

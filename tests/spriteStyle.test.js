import { describe, it, expect } from 'vitest';
import { TILE } from '../src/core/constants.js';
import {
  SPD_SPRITES,
  SPRITE_DIR,
  WALL_SHEET,
  tileSprite,
  entitySprite,
  itemSprite,
  wallMask,
  REMEMBERED_TINT,
} from '../src/renderer/spriteStyle.js';

const KEYS = new Set(SPD_SPRITES.map((s) => s.key));

describe('spriteStyle (pixel seam)', () => {
  it('maps every non-wall tile type to a known sprite key', () => {
    for (const [name, t] of Object.entries(TILE)) {
      if (t === TILE.WALL) continue; // walls come from the autotile sheet
      const key = tileSprite(t);
      expect(key, `TILE.${name} has no sprite`).not.toBeNull();
      expect(KEYS.has(key), `TILE.${name} -> unknown key ${key}`).toBe(true);
    }
  });

  it('draws walls from the autotile sheet, not a single-frame sprite', () => {
    expect(tileSprite(TILE.WALL)).toBeNull();
    expect(WALL_SHEET.frameWidth).toBe(16);
    expect(WALL_SHEET.frameHeight).toBe(16);
    expect(KEYS.has(WALL_SHEET.key)).toBe(false); // separate from load.image set
  });

  it('returns null for an unknown tile type (draw nothing)', () => {
    expect(tileSprite(999)).toBeNull();
  });

  it('maps each entity kind to its sprite, falling back to the player', () => {
    expect(entitySprite({ kind: 'player' })).toBe('spd:player');
    expect(entitySprite({ kind: 'goblin' })).toBe('spd:goblin');
    expect(entitySprite({ kind: 'skeleton' })).toBe('spd:skeleton');
    expect(KEYS.has(entitySprite({ kind: 'nonesuch' }))).toBe(true);
  });

  it('maps the item (potion) to its sprite', () => {
    expect(itemSprite()).toBe('spd:potion');
    expect(KEYS.has(itemSprite())).toBe(true);
  });

  it('has a well-formed, unique, namespaced sprite manifest', () => {
    expect(KEYS.size).toBe(SPD_SPRITES.length); // no duplicate keys
    const files = new Set(SPD_SPRITES.map((s) => s.file));
    expect(files.size).toBe(SPD_SPRITES.length); // no duplicate files
    for (const { key, file } of SPD_SPRITES) {
      expect(key.startsWith('spd:')).toBe(true);
      expect(file.endsWith('.png')).toBe(true);
    }
    expect(SPRITE_DIR.endsWith('/')).toBe(true);
  });

  it('exposes a valid 24-bit remembered-dim tint', () => {
    expect(Number.isInteger(REMEMBERED_TINT)).toBe(true);
    expect(REMEMBERED_TINT).toBeGreaterThanOrEqual(0);
    expect(REMEMBERED_TINT).toBeLessThanOrEqual(0xffffff);
  });
});

describe('wallMask (autotile neighbor bits: N=1 E=2 S=4 W=8)', () => {
  // 3x3 wall block with a single floor pocket at the center (1,1).
  const G = ['###', '#.#', '###'];
  const isWall = (x, y) => (x < 0 || y < 0 || x > 2 || y > 2 ? true : G[y][x] === '#');

  it('opens exactly the edge that faces the floor pocket', () => {
    expect(wallMask(1, 0, isWall)).toBe(4); // floor below  -> S
    expect(wallMask(1, 2, isWall)).toBe(1); // floor above  -> N
    expect(wallMask(0, 1, isWall)).toBe(2); // floor right  -> E
    expect(wallMask(2, 1, isWall)).toBe(8); // floor left   -> W
  });

  it('a wall with no adjacent floor (and map edges) is uncapped => 0', () => {
    // (0,0): N/W are out-of-bounds (treated wall), E/S are walls -> nothing open.
    expect(wallMask(0, 0, isWall)).toBe(0);
  });

  it('two adjacent open sides make a corner (two bits set)', () => {
    // Floor only to the N and E of the tested cell -> N|E.
    const isWall2 = (x, y) => !((x === 1 && y === 0) || (x === 2 && y === 1));
    expect(wallMask(1, 1, isWall2)).toBe(1 | 2);
  });
});

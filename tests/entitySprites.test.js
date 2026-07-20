import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SPRITE_SHEETS,
  ENTITY_SPRITES,
  ITEM_SPRITES,
  SPRITE_LIFT,
  spriteOffset,
  sheetKey,
} from '../src/renderer/entitySprites.js';
import { ENEMY_TYPES, TILE_SIZE } from '../src/core/constants.js';

// PNG width/height from the IHDR chunk (bytes 16..24 big-endian).
function pngSize(path) {
  const b = readFileSync(path);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

describe('entity/item sprite coverage', () => {
  it('covers the player and every enemy kind', () => {
    expect(ENTITY_SPRITES.player).toBeDefined();
    for (const type of Object.values(ENEMY_TYPES)) {
      expect(ENTITY_SPRITES[type.kind], `missing sprite for ${type.kind}`).toBeDefined();
    }
  });

  it('covers both item types', () => {
    expect(ITEM_SPRITES.potion).toBeDefined();
    expect(ITEM_SPRITES.chest).toBeDefined();
  });

  it('every frame names a known sheet', () => {
    for (const s of [...Object.values(ENTITY_SPRITES), ...Object.values(ITEM_SPRITES)]) {
      expect(SPRITE_SHEETS[s.sheet], `unknown sheet ${s.sheet}`).toBeDefined();
    }
  });
});

describe('frame rects against the vendored sheets', () => {
  // The frames must lie inside the real PNGs that ship in public/ — this
  // catches a bad rect or a swapped/re-vendored sheet at test time.
  it('every frame rect fits inside its sheet', () => {
    for (const s of [...Object.values(ENTITY_SPRITES), ...Object.values(ITEM_SPRITES)]) {
      const size = pngSize(`public/${SPRITE_SHEETS[s.sheet]}`);
      expect(s.w).toBeGreaterThan(0);
      expect(s.h).toBeGreaterThan(0);
      expect(s.x + s.w, `${s.sheet} rect x overflow`).toBeLessThanOrEqual(size.width);
      expect(s.y + s.h, `${s.sheet} rect y overflow`).toBeLessThanOrEqual(size.height);
    }
  });

  it('frames fit the tile width and offsets keep them inside it horizontally', () => {
    for (const s of [...Object.values(ENTITY_SPRITES), ...Object.values(ITEM_SPRITES)]) {
      expect(s.w).toBeLessThanOrEqual(TILE_SIZE);
      const { dx } = spriteOffset(s);
      expect(dx).toBeGreaterThanOrEqual(0);
      expect(dx + s.w).toBeLessThanOrEqual(TILE_SIZE);
    }
  });

  it('feet sit SPRITE_LIFT px above the tile bottom edge', () => {
    for (const s of [...Object.values(ENTITY_SPRITES), ...Object.values(ITEM_SPRITES)]) {
      expect(spriteOffset(s).dy + s.h).toBe(TILE_SIZE - SPRITE_LIFT);
    }
  });
});

describe('sheet keys', () => {
  it('namespaces texture keys away from glyph keys', () => {
    expect(sheetKey('warrior')).toBe('sprite:warrior');
  });
});

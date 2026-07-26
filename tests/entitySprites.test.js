import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SPRITE_SHEETS,
  ENTITY_SPRITES,
  ITEM_SPRITES,
  RING_SPRITES,
  SPRITE_LIFT,
  spriteOffset,
  sheetKey,
} from '../src/renderer/entitySprites.js';
import { SHEET_SIZES } from '../src/renderer/uiIcons.js';
import { ENEMY_TYPES, TILE_SIZE, RING_TYPES } from '../src/core/constants.js';

const ALL_FRAMES = () => [
  ...Object.values(ENTITY_SPRITES),
  ...Object.values(ITEM_SPRITES),
  ...Object.values(RING_SPRITES),
];

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

  it('covers every item type', () => {
    expect(ITEM_SPRITES.potion).toBeDefined();
    expect(ITEM_SPRITES.chest).toBeDefined();
    expect(ITEM_SPRITES.lockedChest).toBeDefined();
    expect(ITEM_SPRITES.key).toBeDefined();
  });

  it('covers every ring effect', () => {
    for (const ring of RING_TYPES) {
      expect(RING_SPRITES[ring], `missing ring sprite for ${ring}`).toBeDefined();
    }
  });

  it('the locked chest is visibly a different chest', () => {
    expect(ITEM_SPRITES.lockedChest.x).not.toBe(ITEM_SPRITES.chest.x);
  });

  it('every frame names a known sheet', () => {
    for (const s of ALL_FRAMES()) {
      expect(SPRITE_SHEETS[s.sheet], `unknown sheet ${s.sheet}`).toBeDefined();
    }
  });
});

describe('frame rects against the vendored sheets', () => {
  // The frames must lie inside the real PNGs that ship in public/ — this
  // catches a bad rect or a swapped/re-vendored sheet at test time.
  it('every frame rect fits inside its sheet', () => {
    for (const s of ALL_FRAMES()) {
      const size = pngSize(`public/${SPRITE_SHEETS[s.sheet]}`);
      expect(s.w).toBeGreaterThan(0);
      expect(s.h).toBeGreaterThan(0);
      expect(s.x + s.w, `${s.sheet} rect x overflow`).toBeLessThanOrEqual(size.width);
      expect(s.y + s.h, `${s.sheet} rect y overflow`).toBeLessThanOrEqual(size.height);
    }
  });

  it('frames fit the tile width and offsets keep them inside it horizontally', () => {
    for (const s of ALL_FRAMES()) {
      expect(s.w).toBeLessThanOrEqual(TILE_SIZE);
      const { dx } = spriteOffset(s);
      expect(dx).toBeGreaterThanOrEqual(0);
      expect(dx + s.w).toBeLessThanOrEqual(TILE_SIZE);
    }
  });

  it('feet sit SPRITE_LIFT px above the tile bottom edge', () => {
    for (const s of ALL_FRAMES()) {
      expect(spriteOffset(s).dy + s.h).toBe(TILE_SIZE - SPRITE_LIFT);
    }
  });

  it('every animation column rect fits inside its sheet', () => {
    // Phase 8: idle/walk cycles are columns along each entity's row —
    // frame rect = (x + col*w, y, w, h). All of them must lie inside the
    // shipped PNG, or a bad column list would sample garbage pixels.
    for (const [kind, s] of Object.entries(ENTITY_SPRITES)) {
      expect(s.anims?.idle?.frames?.length, `${kind} has no idle cycle`).toBeGreaterThan(0);
      expect(s.anims?.walk?.frames?.length, `${kind} has no walk cycle`).toBeGreaterThan(0);
      const size = pngSize(`public/${SPRITE_SHEETS[s.sheet]}`);
      for (const [name, a] of Object.entries(s.anims)) {
        expect(a.fps, `${kind} ${name} fps`).toBeGreaterThan(0);
        for (const col of a.frames) {
          expect(s.x + col * s.w + s.w, `${kind} ${name} col ${col} overflows`).toBeLessThanOrEqual(
            size.width,
          );
          expect(s.y + s.h).toBeLessThanOrEqual(size.height);
        }
      }
    }
  });

  it("the UI-icon sheet sizes match the shipped PNGs' headers", () => {
    // uiIcons.js scales CSS crops by these dimensions; a re-vendored sheet
    // with different geometry must fail here, not mis-crop silently.
    for (const [url, dims] of Object.entries(SHEET_SIZES)) {
      const size = pngSize(`public/${url}`);
      expect(size, url).toEqual({ width: dims.width, height: dims.height });
    }
  });
});

describe('sheet keys', () => {
  it('namespaces texture keys away from glyph keys', () => {
    expect(sheetKey('warrior')).toBe('sprite:warrior');
  });
});

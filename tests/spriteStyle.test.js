import { describe, it, expect } from 'vitest';
import { TILE } from '../src/core/constants.js';
import {
  SPD_SPRITES,
  SPRITE_DIR,
  tileSprite,
  entitySprite,
  itemSprite,
  REMEMBERED_TINT,
} from '../src/renderer/spriteStyle.js';

const KEYS = new Set(SPD_SPRITES.map((s) => s.key));

describe('spriteStyle (pixel seam)', () => {
  it('maps every tile type to a known sprite key (parity with ASCII glyphs)', () => {
    for (const [name, t] of Object.entries(TILE)) {
      const key = tileSprite(t);
      expect(key, `TILE.${name} has no sprite`).not.toBeNull();
      expect(KEYS.has(key), `TILE.${name} -> unknown key ${key}`).toBe(true);
    }
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

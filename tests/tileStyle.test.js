import { describe, it, expect } from 'vitest';
import { ALL_GLYPHS, tileGlyph, itemGlyph, entityGlyph } from '../src/renderer/tileStyle.js';
import { ENEMY_TYPES, TILE } from '../src/core/constants.js';

// Glyph textures are pre-baked from ALL_GLYPHS; any glyph the game can produce
// that is missing from that list renders as nothing. Guard the seam.
describe('tileStyle glyph coverage', () => {
  it('covers every tile glyph', () => {
    for (const t of Object.values(TILE)) {
      expect(ALL_GLYPHS).toContain(tileGlyph(t));
    }
  });

  it('covers every enemy glyph (goblin, skeleton, boss) and the player', () => {
    for (const type of Object.values(ENEMY_TYPES)) {
      expect(ALL_GLYPHS).toContain(entityGlyph(type));
    }
    expect(ALL_GLYPHS).toContain('@');
  });

  it('covers every item glyph', () => {
    expect(ALL_GLYPHS).toContain(itemGlyph({ type: 'potion' }));
    expect(ALL_GLYPHS).toContain(itemGlyph({ type: 'chest' }));
  });
});

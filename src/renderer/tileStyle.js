// The sprite-swap seam. Everything the renderer needs to turn a tile type or an
// entity into a glyph + color lives here. To move from ASCII to sprites later,
// only this module (and the texture it feeds) changes — game logic is untouched.

import { TILE } from '../core/constants.js';

// Visibility levels a tile can be drawn at.
export const VIS = Object.freeze({ UNSEEN: 0, EXPLORED: 1, VISIBLE: 2 });

const TILE_GLYPH = {
  [TILE.WALL]: '#',
  [TILE.FLOOR]: '.',
  [TILE.DOOR]: '+',
  [TILE.STAIRS_DOWN]: '>',
  [TILE.STAIRS_UP]: '<',
};

// Lit (currently-visible) colors, as 24-bit RGB for Phaser tint.
const TILE_COLOR = {
  [TILE.WALL]: 0x8a93a6,
  [TILE.FLOOR]: 0x555b6e,
  [TILE.DOOR]: 0xc79a5b,
  [TILE.STAIRS_DOWN]: 0xf2d64b,
  [TILE.STAIRS_UP]: 0xf2d64b,
};

const ENTITY_COLOR = {
  player: 0xffffff,
  goblin: 0x86c25a,
  skeleton: 0xe9e6d6,
};

const POTION_COLOR = 0xe0556b;

// Every glyph the renderer can draw — used to pre-bake glyph textures.
export const ALL_GLYPHS = ['#', '.', '+', '>', '<', '@', 'g', 's', '!'];

export function tileGlyph(tileType) {
  return TILE_GLYPH[tileType] ?? ' ';
}

// Scale an RGB color's brightness by `f` (0..1).
export function scaleColor(rgb, f) {
  const r = Math.round(((rgb >> 16) & 0xff) * f);
  const g = Math.round(((rgb >> 8) & 0xff) * f);
  const b = Math.round((rgb & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

// Color a tile should be drawn at for a given visibility level.
// Explored-but-not-visible tiles are remembered, dimmed. Unseen = not drawn.
export function tileColor(tileType, vis) {
  const base = TILE_COLOR[tileType] ?? 0xffffff;
  if (vis === VIS.EXPLORED) return scaleColor(base, 0.32);
  return base;
}

export function entityGlyph(entity) {
  return entity.glyph;
}

export function entityColor(entity) {
  if (entity.kind === 'player') return ENTITY_COLOR.player;
  return ENTITY_COLOR[entity.kind] ?? 0xffffff;
}

export function itemGlyph() {
  return '!';
}

export function itemColor() {
  return POTION_COLOR;
}

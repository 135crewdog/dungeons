// The sprite-swap seam. Everything the renderer needs to turn a tile type or an
// entity into a glyph + color lives here. To move from ASCII to sprites later,
// only this module (and the texture it feeds) changes — game logic is untouched.

import { TILE } from '../core/constants.js';

// Visibility levels a tile can be drawn at.
export const VIS = Object.freeze({ UNSEEN: 0, EXPLORED: 1, VISIBLE: 2 });

// Which terrain art the scene builds: 'sprites' (the SPD prison tileset with
// autotiled walls) or 'ascii' (the original glyph grid). Entities, items, and
// floating text are ASCII glyphs either way. A pause-menu toggle can later
// swap this at runtime; for now it is a build-time switch, and the scene
// falls back to 'ascii' on its own if the tilesheet fails to load.
export const RENDER_STYLE = 'sprites';

// Explored-but-not-visible sprite tiles get one uniform grey multiply —
// sprites carry their own colors, so the per-type scaled tints above only
// apply to the glyph path.
export const SPRITE_DIM = 0x555555;

// The void behind the map — the letterbox and camera background. This is the
// ONE color shared with the DOM UI (index.html's --c-bg and the <body>
// background must match it by hand) so canvas letterbox and page blend into
// a single surface.
export const BG_COLOR = '#05060a';

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
  boss: 0xd05a5a,
};

const POTION_COLOR = 0xe0556b;
const CHEST_COLOR = 0xe0b74a;

// Floating combat/pickup text colors, as CSS hex strings (Phaser Text takes a
// string fill). Kept here in the style seam rather than inline in the scene so
// every renderer color has one home. Per pickup effect plus the two combat
// outcomes; `damage` doubles as the trap color (both are "you lost HP").
export const FLOAT_COLOR = Object.freeze({
  damage: '#ff5566',
  miss: '#aab2c4',
  heal: '#5ad07a',
  strength: '#e0b74a',
  skill: '#b48ff0',
  armor: '#6db3f2',
});

// Every glyph the renderer can draw — used to pre-bake glyph textures.
export const ALL_GLYPHS = ['#', '.', '+', '>', '<', '@', 'g', 's', 'B', '!', '$'];

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

export function itemGlyph(item) {
  return item.type === 'chest' ? '$' : '!';
}

export function itemColor(item) {
  return item.type === 'chest' ? CHEST_COLOR : POTION_COLOR;
}

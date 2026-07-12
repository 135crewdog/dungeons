// The pixel-art half of the sprite-swap seam — the counterpart to tileStyle.js.
// Pure and Phaser-free: it only names texture keys and the PNG files behind
// them, so it is unit-testable in the node env even though it lives under
// renderer/. Each key maps to a standalone sprite vendored under
// public/sprites/spd/ (provenance + licensing in that dir's CREDITS.txt). The
// pixel painter loads these by key and draws one still frame per tile/entity/
// item; full-color art carries identity, so no per-image tint is used except to
// dim remembered (explored-but-not-visible) tiles.

import { TILE } from '../core/constants.js';

// Directory (relative to the app base) the sprite PNGs are served from. The
// scene prepends import.meta.env.BASE_URL so it resolves under a Pages subpath
// and offline; this module stays free of import.meta to remain node-testable.
export const SPRITE_DIR = 'sprites/spd/';

// Every sprite the pixel style can draw: a namespaced texture key ('spd:*' so
// it never collides with the ASCII 'glyph:*' textures) and its PNG file. The
// scene's loader iterates this to preload the set.
export const SPD_SPRITES = Object.freeze([
  { key: 'spd:floor', file: 'floor.png' },
  { key: 'spd:wall', file: 'wall.png' },
  { key: 'spd:door', file: 'door.png' },
  { key: 'spd:stairs_down', file: 'stairs_down.png' },
  { key: 'spd:stairs_up', file: 'stairs_up.png' },
  { key: 'spd:potion', file: 'potion.png' },
  { key: 'spd:player', file: 'player.png' },
  { key: 'spd:goblin', file: 'goblin.png' },
  { key: 'spd:skeleton', file: 'skeleton.png' },
]);

// Tile type -> sprite key. Mirrors tileStyle.js's TILE_GLYPH; a missing entry
// means "draw nothing" (tileSprite returns null), paralleling tileGlyph -> ' '.
const TILE_SPRITE = {
  [TILE.WALL]: 'spd:wall',
  [TILE.FLOOR]: 'spd:floor',
  [TILE.DOOR]: 'spd:door',
  [TILE.STAIRS_DOWN]: 'spd:stairs_down',
  [TILE.STAIRS_UP]: 'spd:stairs_up',
};

// Enemy/player kind -> sprite key. Mirrors tileStyle.js's ENTITY_COLOR.
const ENTITY_SPRITE = {
  player: 'spd:player',
  goblin: 'spd:goblin',
  skeleton: 'spd:skeleton',
};

// Multiplied over a full-color sprite to render a remembered tile/item darker,
// matching the ~0.32 brightness the ASCII style uses for explored-not-visible.
export const REMEMBERED_TINT = 0x545454;

export function tileSprite(tileType) {
  return TILE_SPRITE[tileType] ?? null;
}

export function entitySprite(entity) {
  return ENTITY_SPRITE[entity.kind] ?? ENTITY_SPRITE.player;
}

export function itemSprite() {
  return 'spd:potion';
}

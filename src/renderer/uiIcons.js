// Sprite-icon specs for the DOM overlays (Help legend, HUD chips). Pure data:
// each spec names a public sheet URL plus a pixel rect, and the composition
// root turns them into CSS-cropped <span>s. This module is the renderer-side
// half of that bridge — ui/ never imports the renderer, so main.js passes an
// icon factory built from these specs into createHelp/createHud.

import { SPRITE_SHEETS, ENTITY_SPRITES, ITEM_SPRITES, RING_SPRITES } from './entitySprites.js';
import { F } from './autotile.js';
import { TILE_SIZE } from '../core/constants.js';

const TERRAIN_SHEET_URL = 'assets/environment/tiles_prison.png';

// Pixel dimensions of every sheet an icon can crop from, keyed by URL. The
// entitySprites test asserts these against the shipped PNGs' IHDRs, so a
// re-vendored or swapped sheet fails in CI instead of silently mis-cropping.
export const SHEET_SIZES = Object.freeze({
  [TERRAIN_SHEET_URL]: { width: 256, height: 256 },
  [SPRITE_SHEETS.warrior]: { width: 256, height: 128 },
  [SPRITE_SHEETS.gnoll]: { width: 256, height: 64 },
  [SPRITE_SHEETS.skeleton]: { width: 256, height: 16 },
  [SPRITE_SHEETS.eye]: { width: 256, height: 32 },
  [SPRITE_SHEETS.items]: { width: 256, height: 512 },
});

// A 16x16 cell on the terrain sheet, by autotile frame index.
function terrainIcon(frame) {
  return {
    url: TERRAIN_SHEET_URL,
    x: (frame % 16) * TILE_SIZE,
    y: Math.floor(frame / 16) * TILE_SIZE,
    w: TILE_SIZE,
    h: TILE_SIZE,
  };
}

function spriteIcon(spec) {
  return { url: SPRITE_SHEETS[spec.sheet], x: spec.x, y: spec.y, w: spec.w, h: spec.h };
}

// Everything the Help legend and HUD chips can show. Ring icons are keyed
// 'ring:<effect>' to match the ring flags' vocabulary.
export const UI_ICONS = Object.freeze({
  player: spriteIcon(ENTITY_SPRITES.player),
  goblin: spriteIcon(ENTITY_SPRITES.goblin),
  skeleton: spriteIcon(ENTITY_SPRITES.skeleton),
  boss: spriteIcon(ENTITY_SPRITES.boss),
  potion: spriteIcon(ITEM_SPRITES.potion),
  chest: spriteIcon(ITEM_SPRITES.chest),
  lockedChest: spriteIcon(ITEM_SPRITES.lockedChest),
  key: spriteIcon(ITEM_SPRITES.key),
  'ring:sight': spriteIcon(RING_SPRITES.sight),
  'ring:shadow': spriteIcon(RING_SPRITES.shadow),
  'ring:speed': spriteIcon(RING_SPRITES.speed),
  'ring:survival': spriteIcon(RING_SPRITES.survival),
  stairsDown: terrainIcon(F.STAIRS_DOWN),
  stairsUp: terrainIcon(F.STAIRS_UP),
  door: terrainIcon(F.RAISED_DOOR),
  wall: terrainIcon(F.RAISED_WALL),
  floor: terrainIcon(F.FLOOR),
});

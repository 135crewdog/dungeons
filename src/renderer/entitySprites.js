// Static sprite frames for entities and items, from the vendored SPD sheets.
// Each frame is an exact sub-rect of its sheet, taken from Shattered Pixel
// Dungeon's own sprite classes (HeroSprite, GnollSprite, SkeletonSprite,
// TenguSprite, ItemSpriteSheet) — the first idle frame of each animation, so
// creatures render in their natural standing pose. Character frames are
// smaller than the 16px tile (12×15, Tengu 14×16); spriteOffset() centers
// them horizontally and plants their feet on the tile's bottom edge. Pure
// data + one scene-wiring helper, so the table tests without Phaser.

import { TILE_SIZE } from '../core/constants.js';

// Sheet name → URL (relative to index.html, same convention as the tileset).
export const SPRITE_SHEETS = Object.freeze({
  warrior: 'assets/sprites/warrior.png',
  gnoll: 'assets/sprites/gnoll.png',
  skeleton: 'assets/sprites/skeleton.png',
  tengu: 'assets/sprites/tengu.png',
  items: 'assets/sprites/items.png',
});

export function sheetKey(name) {
  return 'sprite:' + name;
}

// entity.kind → frame. The player is the warrior's bottom sheet row (SPD's
// tier-6 "class armor" look); the boss is Tengu, the SPD prison-depth boss.
export const ENTITY_SPRITES = Object.freeze({
  player: { sheet: 'warrior', x: 0, y: 90, w: 12, h: 15 },
  goblin: { sheet: 'gnoll', x: 0, y: 0, w: 12, h: 15 },
  skeleton: { sheet: 'skeleton', x: 0, y: 0, w: 12, h: 15 },
  boss: { sheet: 'tengu', x: 0, y: 0, w: 14, h: 16 },
});

// item.type → frame: SPD's POTION_CRIMSON flask and LOCKED_CHEST (the golden
// treasure chest).
export const ITEM_SPRITES = Object.freeze({
  potion: { sheet: 'items', x: 0, y: 352, w: 12, h: 14 },
  chest: { sheet: 'items', x: 80, y: 32, w: 16, h: 14 },
});

// Pixel offset that centers a frame horizontally in its tile and aligns its
// bottom edge (feet) with the tile's bottom edge.
export function spriteOffset(spec) {
  return { dx: Math.floor((TILE_SIZE - spec.w) / 2), dy: TILE_SIZE - spec.h };
}

// Register every frame on its loaded sheet texture, named by entity kind /
// item type, so images can be created as (sheetKey(sheet), name).
export function registerSpriteFrames(scene) {
  for (const table of [ENTITY_SPRITES, ITEM_SPRITES]) {
    for (const [name, s] of Object.entries(table)) {
      const tex = scene.textures.get(sheetKey(s.sheet));
      if (!tex.has(name)) tex.add(name, 0, s.x, s.y, s.w, s.h);
    }
  }
}

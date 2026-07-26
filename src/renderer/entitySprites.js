// Static sprite frames for entities and items, from the vendored SPD sheets.
// Each frame is an exact sub-rect of its sheet, taken from Shattered Pixel
// Dungeon's own sprite classes (HeroSprite, GnollSprite, SkeletonSprite,
// EyeSprite, ItemSpriteSheet) — the first idle frame of each animation, so
// creatures render in their natural standing pose. Character frames are
// sub-tile (12×15; the eye 16×18, poking above its tile); spriteOffset()
// centers them horizontally with feet SPRITE_LIFT px above the tile's bottom
// edge. Pure data + one scene-wiring helper, so the table tests without
// Phaser.

import { TILE_SIZE } from '../core/constants.js';

// Sheet name → URL (relative to index.html, same convention as the tileset).
export const SPRITE_SHEETS = Object.freeze({
  warrior: 'assets/sprites/warrior.png',
  gnoll: 'assets/sprites/gnoll.png',
  skeleton: 'assets/sprites/skeleton.png',
  eye: 'assets/sprites/eye.png',
  items: 'assets/sprites/items.png',
});

export function sheetKey(name) {
  return 'sprite:' + name;
}

// entity.kind → frame. The player is the warrior's tier-5 sheet row (rows
// are 15px, row N = armor tier N); the boss is SPD's evil Eye (16×18 frames
// per EyeSprite's TextureFilm — taller than a tile, so it floats up into
// the cell above).
export const ENTITY_SPRITES = Object.freeze({
  player: { sheet: 'warrior', x: 0, y: 75, w: 12, h: 15 },
  goblin: { sheet: 'gnoll', x: 0, y: 0, w: 12, h: 15 },
  skeleton: { sheet: 'skeleton', x: 0, y: 0, w: 12, h: 15 },
  boss: { sheet: 'eye', x: 0, y: 0, w: 16, h: 18 },
});

// item.type → frame: SPD's POTION_CRIMSON flask, the golden treasure chest,
// the blue CRYSTAL_CHEST (the Phase-7 locked chest — deliberately a different
// chest so "locked" reads at a glance), and the GOLDEN_KEY.
export const ITEM_SPRITES = Object.freeze({
  potion: { sheet: 'items', x: 0, y: 352, w: 12, h: 14 },
  chest: { sheet: 'items', x: 80, y: 32, w: 16, h: 14 },
  lockedChest: { sheet: 'items', x: 96, y: 32, w: 16, h: 14 },
  key: { sheet: 'items', x: 128, y: 48, w: 8, h: 14 },
});

// ring effect → frame: the SPD ring row (y=224), one gem per effect —
// Sapphire for Sight, Onyx for Shadow, Topaz for Speed, Ruby for Survival.
// Ring items carry `item.ring`, so they key off this table, not ITEM_SPRITES.
export const RING_SPRITES = Object.freeze({
  sight: { sheet: 'items', x: 112, y: 224, w: 8, h: 10 },
  shadow: { sheet: 'items', x: 64, y: 224, w: 8, h: 10 },
  speed: { sheet: 'items', x: 32, y: 224, w: 8, h: 10 },
  survival: { sheet: 'items', x: 16, y: 224, w: 8, h: 10 },
});

// Texture-frame name for a ring effect (registered alongside the item frames).
export function ringFrameName(ring) {
  return 'ring:' + ring;
}

// Feet sit this many pixels above the tile's bottom edge — nearer the tile's
// center, so actors clear the south wall tops (drawn over them) and line up
// with sideways doors instead of sinking behind the pseudo-3D wall layer.
export const SPRITE_LIFT = 5;

// Pixel offset that centers a frame horizontally in its tile and rests its
// bottom edge (feet) SPRITE_LIFT px above the tile's bottom edge. dy may be
// negative for frames taller than TILE_SIZE - SPRITE_LIFT: they extend into
// the tile above, still underneath the walls layer.
export function spriteOffset(spec) {
  return { dx: Math.floor((TILE_SIZE - spec.w) / 2), dy: TILE_SIZE - spec.h - SPRITE_LIFT };
}

// Register every frame on its loaded sheet texture, named by entity kind /
// item type / ring effect, so images can be created as (sheetKey(sheet), name).
export function registerSpriteFrames(scene) {
  for (const table of [ENTITY_SPRITES, ITEM_SPRITES]) {
    for (const [name, s] of Object.entries(table)) {
      const tex = scene.textures.get(sheetKey(s.sheet));
      if (!tex.has(name)) tex.add(name, 0, s.x, s.y, s.w, s.h);
    }
  }
  for (const [ring, s] of Object.entries(RING_SPRITES)) {
    const tex = scene.textures.get(sheetKey(s.sheet));
    const name = ringFrameName(ring);
    if (!tex.has(name)) tex.add(name, 0, s.x, s.y, s.w, s.h);
  }
}

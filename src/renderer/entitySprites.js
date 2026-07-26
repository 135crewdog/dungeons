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
// the cell above). (x, y, w, h) is the base standing frame; `anims` lists
// the idle/walk cycles as COLUMN indices along the same row (frame rect =
// x + col*w), straight from SPD's sprite classes — the sheets have always
// shipped these frames, Phase 8 just plays them. fps values are SPD-ish:
// slow blinking idles, brisk walks. The eye has no legs — its "walk" is a
// faster float of the same wobble.
export const ENTITY_SPRITES = Object.freeze({
  player: {
    sheet: 'warrior',
    x: 0,
    y: 75,
    w: 12,
    h: 15,
    anims: { idle: { frames: [0, 1], fps: 2 }, walk: { frames: [2, 3, 4, 5, 6, 7], fps: 12 } },
  },
  goblin: {
    sheet: 'gnoll',
    x: 0,
    y: 0,
    w: 12,
    h: 15,
    anims: { idle: { frames: [0, 1], fps: 2 }, walk: { frames: [2, 3, 4, 5, 6], fps: 12 } },
  },
  skeleton: {
    sheet: 'skeleton',
    x: 0,
    y: 0,
    w: 12,
    h: 15,
    anims: { idle: { frames: [0, 1], fps: 2 }, walk: { frames: [2, 3, 4, 5], fps: 10 } },
  },
  boss: {
    sheet: 'eye',
    x: 0,
    y: 0,
    w: 16,
    h: 18,
    anims: { idle: { frames: [0, 1, 2], fps: 4 }, walk: { frames: [0, 1, 2], fps: 8 } },
  },
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

// Texture-frame name for an animation column: column 0 is the base frame and
// keeps the bare kind name (everything created before Phase 8 still works).
export function colFrameName(kind, col) {
  return col === 0 ? kind : `${kind}#${col}`;
}

// Phaser Animation key for a kind's cycle ('idle' | 'walk').
export function animKey(kind, name) {
  return `anim:${kind}:${name}`;
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

// Register every frame on its loaded sheet texture — entity kinds (plus each
// animation column along their row), item types, ring effects — and create
// the idle/walk Phaser Animations, so sprites can be created as
// (sheetKey(sheet), name) and played via animKey(kind, 'idle'|'walk').
export function registerSpriteFrames(scene) {
  for (const [kind, s] of Object.entries(ENTITY_SPRITES)) {
    const tex = scene.textures.get(sheetKey(s.sheet));
    const cols = new Set([0]);
    for (const a of Object.values(s.anims ?? {})) for (const c of a.frames) cols.add(c);
    for (const col of cols) {
      const name = colFrameName(kind, col);
      if (!tex.has(name)) tex.add(name, 0, s.x + col * s.w, s.y, s.w, s.h);
    }
    for (const [animName, a] of Object.entries(s.anims ?? {})) {
      const key = animKey(kind, animName);
      if (scene.anims.exists(key)) continue;
      scene.anims.create({
        key,
        frames: a.frames.map((col) => ({ key: sheetKey(s.sheet), frame: colFrameName(kind, col) })),
        frameRate: a.fps,
        repeat: -1,
      });
    }
  }
  for (const [name, s] of Object.entries(ITEM_SPRITES)) {
    const tex = scene.textures.get(sheetKey(s.sheet));
    if (!tex.has(name)) tex.add(name, 0, s.x, s.y, s.w, s.h);
  }
  for (const [ring, s] of Object.entries(RING_SPRITES)) {
    const tex = scene.textures.get(sheetKey(s.sheet));
    const name = ringFrameName(ring);
    if (!tex.has(name)) tex.add(name, 0, s.x, s.y, s.w, s.h);
  }
}

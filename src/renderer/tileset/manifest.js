// The tileset seam: maps our simulation's tiles / entity kinds / items onto
// named frames of the 0x72 Dungeon Tileset II atlas, and declares the sprite
// animations. Pure data + resolvers, no Phaser — so it is browser-testable and
// is the ONE file to edit if the art is ever swapped again.
//
// Frame names follow the atlas convention `${base}_${action}_anim_f${i}`
// (see tile_list_v1.7). This tileset has idle/run for every creature and a
// single hit frame for heroes only; there are NO death frames, so death falls
// back to hit→idle and is sold with a dissolve in the renderer.

// The Phaser texture key the combined atlas is loaded under; every frame
// registered from tile_list lives on this texture.
export const ATLAS_KEY = 'dungeon';

// Our entity.kind -> the atlas sprite base that represents it.
export const ENTITY_SPRITE = Object.freeze({
  player: 'knight_m',
  goblin: 'goblin',
  skeleton: 'skelet',
});

// Which actions each sprite base actually has, and how many frames each is.
const SPRITE_SPEC = Object.freeze({
  knight_m: { idle: 4, run: 4, hit: 1 },
  goblin: { idle: 4, run: 4 },
  skelet: { idle: 4, run: 4 },
});

// Frames per second per action, and whether it loops.
const ACTION_FPS = Object.freeze({ idle: 4, run: 8, hit: 16, death: 12 });
const LOOPING = Object.freeze({ idle: true, run: true, hit: false, death: false });

// Tiles / items.
export const FLOOR_FRAMES = Object.freeze([
  'floor_1', 'floor_2', 'floor_3', 'floor_4', 'floor_5', 'floor_6', 'floor_7', 'floor_8',
]);
export const STAIRS_FRAME = 'floor_stairs';
export const POTION_FRAME = 'flask_red';

// Named wall pieces used to assemble the 2.5D walls (TileLayer owns the
// selection logic; these are the vocabulary it draws from). All names exist in
// tile_list_v1.7: `wall_mid/left/right` are the brick FACE and its ends;
// `wall_top_mid/left/right` are the flat TOP cap and its ends.
export const WALL_FRAMES = Object.freeze({
  face: 'wall_mid',
  faceLeft: 'wall_left',
  faceRight: 'wall_right',
  topMid: 'wall_top_mid',
  topLeft: 'wall_top_left',
  topRight: 'wall_top_right',
  // Tan "top surface" strips for vertical (E/W) walls — no brick face. The tan
  // must face the ROOM (the other side is transparent, i.e. the black void
  // outside): a room's LEFT/west wall (room to its east) uses `edgeMidRight`
  // (tan on the right); its RIGHT/east wall uses `edgeMidLeft` (tan on left).
  edgeMidLeft: 'wall_edge_mid_left',
  edgeMidRight: 'wall_edge_mid_right',
});

// The base sprite for an entity kind, defaulting to the player's if unknown so
// a new enemy type never renders nothing.
export function entitySprite(kind) {
  return ENTITY_SPRITE[kind] ?? ENTITY_SPRITE.player;
}

// Resolve a requested action to one the base actually has, following a
// graceful fallback chain (so missing hit/death/run never break animation).
export function resolveAction(base, action) {
  const spec = SPRITE_SPEC[base] ?? SPRITE_SPEC.knight_m;
  const chain = {
    idle: ['idle'],
    run: ['run', 'idle'],
    walk: ['run', 'idle'],
    hit: ['hit', 'idle'],
    attack: ['hit', 'idle'],
    death: ['death', 'hit', 'idle'],
  }[action] ?? ['idle'];
  for (const a of chain) if (spec[a]) return a;
  return 'idle';
}

// Build the ordered frame-name list for a base+action straight from the atlas
// naming convention.
export function frameNames(base, action) {
  const spec = SPRITE_SPEC[base] ?? SPRITE_SPEC.knight_m;
  const count = spec[action] ?? 1;
  const names = [];
  for (let i = 0; i < count; i++) names.push(`${base}_${action}_anim_f${i}`);
  return names;
}

// The Phaser animation key for a base+action (stable across the app).
export function animKey(base, action) {
  return `${base}_${action}`;
}

// Every animation the loader must register: one per (base, real action).
export function animSpecs() {
  const specs = [];
  for (const base of Object.keys(SPRITE_SPEC)) {
    for (const action of Object.keys(SPRITE_SPEC[base])) {
      specs.push({
        key: animKey(base, action),
        frames: frameNames(base, action),
        frameRate: ACTION_FPS[action] ?? 8,
        repeat: LOOPING[action] ? -1 : 0,
      });
    }
  }
  return specs;
}

// Convenience for the renderer: the anim key to play for an entity kind +
// desired action, already fallback-resolved.
export function entityAnimKey(kind, action) {
  const base = entitySprite(kind);
  return animKey(base, resolveAction(base, action));
}

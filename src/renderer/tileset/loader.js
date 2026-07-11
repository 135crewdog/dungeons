// Phaser-side atlas wiring: turn the loaded combined PNG + parsed tile_list into
// named frames, then register the sprite animations. Runs once in the scene's
// create() (after preload() has fetched the image). Isolated here so the scene
// stays readable and the pure logic (manifest, tileList) has no Phaser.

import { ATLAS_KEY, animSpecs } from './manifest.js';

// Add every `name -> {x,y,w,h}` rectangle as a named frame on the atlas texture,
// so sprites and animations can reference frames by their 0x72 names.
export function registerAtlasFrames(scene, frames) {
  const tex = scene.textures.get(ATLAS_KEY);
  for (const [name, r] of frames) {
    if (!tex.has(name)) tex.add(name, 0, r.x, r.y, r.w, r.h);
  }
}

// Create every creature animation the manifest declares (idempotent).
export function registerAnims(scene) {
  for (const spec of animSpecs()) {
    if (scene.anims.exists(spec.key)) continue;
    scene.anims.create({
      key: spec.key,
      frames: spec.frames.map((frame) => ({ key: ATLAS_KEY, frame })),
      frameRate: spec.frameRate,
      repeat: spec.repeat,
    });
  }
}

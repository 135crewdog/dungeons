import { TILE_SIZE } from '../core/constants.js';

const STYLE = {
  fontFamily: '"DejaVu Sans Mono", "Courier New", monospace',
  fontSize: '11px',
  fontStyle: 'bold',
};

// Spawn a short-lived number/word that floats up and fades over a tile. Used for
// combat feedback ("Miss!" and damage) and pickups. Pure renderer concern —
// driven by the event list the simulation returns, never by the simulation
// itself.
//
// Text objects are pooled per scene: each Phaser Text carries its own canvas
// texture, so creating and destroying one per swing was the renderer's one real
// allocation/GC hotspot. Finished labels park in a free list and get re-dressed
// (text/color/position) on the next spawn.
export function spawnFloatingText(scene, tileX, tileY, text, color) {
  const px = tileX * TILE_SIZE + TILE_SIZE / 2;
  const py = tileY * TILE_SIZE + 1;

  const pool = (scene._floatPool ??= []);
  let label = pool.pop();
  if (!label) {
    label = scene.add.text(0, 0, '', STYLE).setOrigin(0.5, 1).setDepth(1000).setResolution(3);
  }
  label
    .setText(text)
    .setColor(color)
    .setPosition(px, py)
    .setAlpha(1)
    .setVisible(true)
    .setActive(true);

  scene.tweens.add({
    targets: label,
    y: py - TILE_SIZE,
    alpha: 0,
    duration: 650,
    ease: 'Quad.easeOut',
    onComplete: () => {
      label.setVisible(false).setActive(false);
      pool.push(label);
    },
  });
}

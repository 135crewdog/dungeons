import { TILE_SIZE } from '../core/constants.js';

// Spawn a short-lived number/word that floats up and fades over a tile. Used for
// combat feedback ("Miss!" and damage). Pure renderer concern — driven by the
// event list the simulation returns, never by the simulation itself.
export function spawnFloatingText(scene, tileX, tileY, text, color) {
  const px = tileX * TILE_SIZE + TILE_SIZE / 2;
  const py = tileY * TILE_SIZE + 1;
  const label = scene.add
    .text(px, py, text, {
      fontFamily: '"DejaVu Sans Mono", "Courier New", monospace',
      fontSize: '11px',
      color,
      fontStyle: 'bold',
    })
    .setOrigin(0.5, 1)
    .setDepth(1000)
    .setResolution(3);

  scene.tweens.add({
    targets: label,
    y: py - TILE_SIZE,
    alpha: 0,
    duration: 650,
    ease: 'Quad.easeOut',
    onComplete: () => label.destroy(),
  });
}

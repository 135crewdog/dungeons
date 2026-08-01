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

  // Rise half a tile, not a whole one, and clear out faster. At auto-walk pace
  // a full-tile 650ms drift left several labels in the air at once, each ending
  // a tile away from the fight that produced it — which reads as damage being
  // dealt between entities that aren't touching.
  scene.tweens.add({
    targets: label,
    y: py - TILE_SIZE / 2,
    alpha: 0,
    duration: 450,
    ease: 'Quad.easeOut',
    onComplete: () => {
      label.setVisible(false).setActive(false);
      pool.push(label);
    },
  });
}

// Kill every in-flight label and park it back in the pool. Floats are addressed
// in WORLD pixels, and a 450ms rise outlives a 110ms step, so a hit taken two
// or three steps before the stairs was still in the air when the floor swapped
// — and then finished floating over an unrelated tile of the new map. Called
// from rebuildFloor, alongside motion.clear(), for the same reason.
export function clearFloatingText(scene) {
  const pool = (scene._floatPool ??= []);
  for (const label of pool) scene.tweens.killTweensOf(label);
  // Labels currently mid-tween are not in the pool (they return on complete),
  // so sweep the display list for the ones this module owns.
  for (const label of scene.children.list.filter((c) => c.type === 'Text' && c.depth === 1000)) {
    scene.tweens.killTweensOf(label);
    label.setVisible(false).setActive(false);
    if (!pool.includes(label)) pool.push(label);
  }
}

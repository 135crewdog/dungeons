import Phaser from 'phaser';
import { DungeonScene } from './GameScene.js';
import { BG_COLOR } from './tileStyle.js';

// Phaser lives ONLY in the renderer layer. The render buffer is sized in DEVICE
// pixels (window × dpr) for crispness on hi-dpi screens; the scene's fitToWindow
// keeps it in sync and applies INTEGER camera zoom so a bigger screen reveals
// MORE tiles (not bigger ones). Leftover space beyond the map edges shows the
// neutral background — the letterbox.
export function createPhaserGame(parent, state) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: BG_COLOR,
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.NONE,
      width: Math.max(1, Math.floor(window.innerWidth * dpr)),
      height: Math.max(1, Math.floor(window.innerHeight * dpr)),
    },
    callbacks: {
      // Available before scenes boot, so DungeonScene.create can read it.
      preBoot: (game) => game.registry.set('state', state),
    },
    scene: [DungeonScene],
  });
}

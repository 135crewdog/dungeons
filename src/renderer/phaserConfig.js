import Phaser from 'phaser';
import { DungeonScene } from './GameScene.js';

// Phaser lives ONLY in the renderer layer. Scale.RESIZE keeps the game surface
// equal to the window (so bigger screens reveal MORE tiles), while the scene's
// camera applies INTEGER zoom for crisp glyphs and follows the player. Leftover
// space beyond the map edges shows the neutral background — the letterbox.
export function createPhaserGame(parent, state) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#05060a',
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    callbacks: {
      // Available before scenes boot, so DungeonScene.create can read it.
      preBoot: (game) => game.registry.set('state', state),
    },
    scene: [DungeonScene],
  });
}

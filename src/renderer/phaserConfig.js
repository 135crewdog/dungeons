import Phaser from 'phaser';
import { BootScene } from './GameScene.js';

// Phaser lives ONLY in the renderer layer. This module builds the Phaser.Game
// configuration. Integer scaling + letterboxing is refined in a later milestone;
// for now the canvas fills the window so the boot pipeline is visible.
export function createPhaserGame(parent) {
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
    scene: [BootScene],
  });
}

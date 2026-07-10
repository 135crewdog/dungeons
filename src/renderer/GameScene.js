import Phaser from 'phaser';

// Placeholder scene for the scaffold milestone. It proves the render pipeline
// boots and draws monospace ASCII. It is replaced by the real dungeon scene
// (glyph pool + camera follow + event effects) in a later milestone.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create() {
    const style = {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#c8d0e0',
    };
    const lines = [
      '@  dungeons',
      '',
      'render pipeline online',
      'simulation to follow',
    ];
    this.label = this.add
      .text(0, 0, lines.join('\n'), style)
      .setOrigin(0.5)
      .setResolution(2);

    this.reflow();
    this.scale.on('resize', this.reflow, this);
  }

  reflow() {
    if (!this.label) return;
    this.label.setPosition(this.scale.width / 2, this.scale.height / 2);
  }
}

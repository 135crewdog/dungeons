import { describe, it, expect } from 'vitest';
import { parseTileList } from '../src/renderer/tileset/tileList.js';

describe('parseTileList', () => {
  it('parses `name x y w h` rows into integer rectangles', () => {
    const frames = parseTileList('goblin_idle_anim_f0 368 40 16 16\nfloor_1 16 64 16 16\n');
    expect(frames.get('goblin_idle_anim_f0')).toEqual({ x: 368, y: 40, w: 16, h: 16 });
    expect(frames.get('floor_1')).toEqual({ x: 16, y: 64, w: 16, h: 16 });
    expect(frames.size).toBe(2);
  });

  it('handles the tall hero and big-monster frame sizes', () => {
    const frames = parseTileList('knight_m_idle_anim_f0 128 100 16 28\nbig_demon_idle_anim_f0 16 428 32 36');
    expect(frames.get('knight_m_idle_anim_f0')).toEqual({ x: 128, y: 100, w: 16, h: 28 });
    expect(frames.get('big_demon_idle_anim_f0')).toEqual({ x: 16, y: 428, w: 32, h: 36 });
  });

  it('skips blank lines and malformed rows instead of throwing', () => {
    const frames = parseTileList('\n  \nfloor_stairs 80 192 16 16\nbroken row here now\ntoo few 1 2\n');
    expect(frames.size).toBe(1);
    expect(frames.get('floor_stairs')).toEqual({ x: 80, y: 192, w: 16, h: 16 });
  });

  it('is tolerant of trailing whitespace and multiple spaces', () => {
    const frames = parseTileList('  wall_mid   32   16 16 16   ');
    expect(frames.get('wall_mid')).toEqual({ x: 32, y: 16, w: 16, h: 16 });
  });
});

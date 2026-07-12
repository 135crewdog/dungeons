import { describe, it, expect } from 'vitest';
import {
  ENTITY_SPRITE,
  FLOOR_FRAMES,
  STAIRS_DOWN_FRAME,
  STAIRS_UP_FRAME,
  POTION_FRAME,
  entitySprite,
  resolveAction,
  frameNames,
  animKey,
  animSpecs,
  entityAnimKey,
} from '../src/renderer/tileset/manifest.js';

describe('entity → sprite mapping', () => {
  it('maps our three kinds onto atlas sprite bases', () => {
    expect(entitySprite('player')).toBe('knight_m');
    expect(entitySprite('goblin')).toBe('goblin');
    expect(entitySprite('skeleton')).toBe('skelet');
  });

  it('falls back to the player sprite for unknown kinds', () => {
    expect(entitySprite('dragon')).toBe(ENTITY_SPRITE.player);
  });
});

describe('frameNames', () => {
  it('builds the atlas naming convention', () => {
    expect(frameNames('knight_m', 'idle')).toEqual([
      'knight_m_idle_anim_f0',
      'knight_m_idle_anim_f1',
      'knight_m_idle_anim_f2',
      'knight_m_idle_anim_f3',
    ]);
    expect(frameNames('goblin', 'run')).toEqual([
      'goblin_run_anim_f0',
      'goblin_run_anim_f1',
      'goblin_run_anim_f2',
      'goblin_run_anim_f3',
    ]);
    expect(frameNames('knight_m', 'hit')).toEqual(['knight_m_hit_anim_f0']);
  });
});

describe('resolveAction fallback chains', () => {
  it('uses the action when the base has it', () => {
    expect(resolveAction('knight_m', 'hit')).toBe('hit');
    expect(resolveAction('goblin', 'run')).toBe('run');
  });

  it('falls back for actions the tileset lacks', () => {
    // Goblin/skeleton have no hit or death frames.
    expect(resolveAction('goblin', 'hit')).toBe('idle');
    expect(resolveAction('skelet', 'death')).toBe('idle');
    // Heroes have hit but no death.
    expect(resolveAction('knight_m', 'death')).toBe('hit');
    // walk is an alias for run.
    expect(resolveAction('goblin', 'walk')).toBe('run');
  });
});

describe('animSpecs / keys', () => {
  it('produces a registerable spec per real (base, action)', () => {
    const specs = animSpecs();
    const keys = specs.map((s) => s.key);
    expect(keys).toContain('knight_m_idle');
    expect(keys).toContain('knight_m_run');
    expect(keys).toContain('knight_m_hit');
    expect(keys).toContain('goblin_idle');
    expect(keys).toContain('skelet_run');
    // Goblin/skeleton have no hit anim registered.
    expect(keys).not.toContain('goblin_hit');
  });

  it('loops idle/run but not hit', () => {
    const specs = animSpecs();
    const idle = specs.find((s) => s.key === 'knight_m_idle');
    const hit = specs.find((s) => s.key === 'knight_m_hit');
    expect(idle.repeat).toBe(-1);
    expect(hit.repeat).toBe(0);
    expect(idle.frames.length).toBe(4);
    expect(hit.frames.length).toBe(1);
  });

  it('entityAnimKey resolves kind+action to a real anim key', () => {
    expect(entityAnimKey('player', 'idle')).toBe(animKey('knight_m', 'idle'));
    expect(entityAnimKey('goblin', 'hit')).toBe(animKey('goblin', 'idle')); // fallback
    expect(entityAnimKey('skeleton', 'walk')).toBe(animKey('skelet', 'run'));
  });
});

describe('tile/item frame constants', () => {
  it('exposes floor variants, both stairs and potion', () => {
    expect(FLOOR_FRAMES.length).toBe(8);
    expect(FLOOR_FRAMES[0]).toBe('floor_1');
    expect(STAIRS_DOWN_FRAME).toBe('floor_stairs');
    expect(STAIRS_UP_FRAME).toBe('floor_ladder');
    expect(POTION_FRAME).toBe('flask_red');
  });
});

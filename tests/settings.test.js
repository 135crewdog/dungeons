import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { coerceArtStyle, loadArtStyle, saveArtStyle } from '../src/ui/settings.js';

describe('coerceArtStyle', () => {
  it('accepts the two known styles', () => {
    expect(coerceArtStyle('pixel')).toBe('pixel');
    expect(coerceArtStyle('ascii')).toBe('ascii');
  });

  it('defaults anything else to ascii', () => {
    for (const bad of [null, undefined, '', 'garbage', 'PIXEL', 0, {}]) {
      expect(coerceArtStyle(bad)).toBe('ascii');
    }
  });
});

describe('load/saveArtStyle', () => {
  afterEach(() => {
    delete globalThis.localStorage;
  });

  it('round-trips through localStorage', () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    };
    expect(loadArtStyle()).toBe('ascii'); // nothing stored yet
    saveArtStyle('pixel');
    expect(loadArtStyle()).toBe('pixel');
    saveArtStyle('ascii');
    expect(loadArtStyle()).toBe('ascii');
  });

  it('persists only normalized values', () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    };
    saveArtStyle('garbage');
    expect(loadArtStyle()).toBe('ascii');
  });

  it('never throws when storage is unavailable', () => {
    // No globalThis.localStorage defined -> access throws internally.
    expect(() => saveArtStyle('pixel')).not.toThrow();
    expect(loadArtStyle()).toBe('ascii');
  });

  it('never throws when storage access itself throws (private mode / quota)', () => {
    globalThis.localStorage = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('quota');
      },
    };
    expect(loadArtStyle()).toBe('ascii');
    expect(() => saveArtStyle('pixel')).not.toThrow();
  });
});

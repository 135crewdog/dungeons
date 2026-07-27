// Guards the page's touch-gesture policy (WCAG 1.4.4: content must be
// zoomable). Gesture suppression belongs to the map surface, which needs raw
// taps and no double-tap zoom; it must never be applied page-wide, because the
// DOM overlays (help, menu, leaderboard, death screen) are ordinary text that a
// low-vision player has to be able to pinch-zoom and scroll.
//
// This is a static check on index.html — the same spirit as the architecture
// guards, and cheap enough to catch the regression the moment it is written.
// The browser campaign asserts the *computed* result in a real engine.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const { window } = new JSDOM(html);
const { document } = window;

// Every CSSStyleRule across the page's <style> blocks, as [selector, style].
// A grouped selector ("html, body { … }") contributes one entry per selector.
const rules = [...document.styleSheets]
  .flatMap((sheet) => [...sheet.cssRules])
  .filter((rule) => rule.selectorText)
  .flatMap((rule) => rule.selectorText.split(',').map((sel) => [sel.trim(), rule.style]));

// Read through getPropertyValue, NOT the camelCase accessor: jsdom's CSSOM
// keeps the declaration but has no `touchAction` property, so `style.touchAction`
// is undefined for every rule — which would make each assertion below pass
// vacuously.
const touchActionFor = (selector) =>
  rules
    .filter(([sel]) => sel === selector)
    .map(([, style]) => style.getPropertyValue('touch-action'))
    .filter((value) => value !== '');

describe('touch gesture policy', () => {
  it('does not suppress gestures page-wide', () => {
    for (const selector of ['html', 'body', '*', ':root']) {
      expect(touchActionFor(selector)).not.toContain('none');
    }
  });

  it('does suppress them on the game surface', () => {
    // The other half of the contract: taps must still map to tiles without the
    // browser hijacking them for scroll/zoom while playing.
    expect(touchActionFor('#game')).toContain('none');
  });

  it('leaves the overlay panels zoomable and scrollable', () => {
    // `manipulation` drops only the double-tap zoom delay; pan and pinch-zoom
    // both survive it. `none` here would re-break magnification.
    for (const panel of ['.menu-panel', '.help-panel', '.lb-panel', '.go-panel']) {
      const values = touchActionFor(panel);
      expect(values).not.toContain('none');
      expect(values).toContain('manipulation');
    }
  });

  it('keeps the viewport meta zoomable', () => {
    const content = document.querySelector('meta[name="viewport"]').getAttribute('content');
    expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
    expect(content).not.toMatch(/maximum-scale/i);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createHelp } from '../src/ui/help.js';
import { createLeaderboard } from '../src/ui/leaderboard.js';
import { trapTabKey } from '../src/ui/dom.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('help overlay', () => {
  it('opens and closes and lists the legend, stats, and controls', () => {
    const help = createHelp(document.body);
    expect(help.isOpen()).toBe(false);
    help.open();
    expect(help.isOpen()).toBe(true);
    const text = help.el.textContent;
    expect(text).toContain('Goblin');
    expect(text).toContain('Strength');
    expect(text).toContain('Numpad');
    // six tables: denizens, loot, rings, dungeon, stats, controls
    expect(help.el.querySelectorAll('.help-table').length).toBe(6);
    help.close();
    expect(help.isOpen()).toBe(false);
  });

  it('Escape closes it', () => {
    const help = createHelp(document.body);
    help.open();
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(help.isOpen()).toBe(false);
  });

  it('restores focus to the opener when closed', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Help';
    document.body.appendChild(opener);
    opener.focus();
    const help = createHelp(document.body);
    help.open();
    expect(document.activeElement).not.toBe(opener); // panel took focus
    help.close();
    expect(document.activeElement).toBe(opener);
  });

  it('traps Tab inside the open dialog', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const help = createHelp(document.body);
    help.open();
    // The help panel's only focusable is the × close button: Tab from it (the
    // last focusable) must wrap back to the first, never escape the dialog.
    const closeBtn = help.el.querySelector('.menu-x');
    closeBtn.focus();
    const tab = new window.KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    closeBtn.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeBtn); // wrapped to first (itself)
  });
});

describe('leaderboard overlay', () => {
  const rows = [
    { initials: 'AAA', floor: 9, version: '0.5.1', created_at: 100 },
    { initials: '<b>', floor: 5, version: '0.5.1', created_at: 50 },
  ];

  it('renders rows as text and never as markup (XSS-safe)', async () => {
    const lb = createLeaderboard(document.body, {
      fetchScores: () => Promise.resolve({ ok: true, scores: rows, now: 1000 }),
    });
    await lb.open();
    expect(lb.el.querySelectorAll('.lb-table tr').length).toBe(rows.length + 1); // + header
    // the hostile initials render as literal text, not an injected element
    expect(lb.el.querySelector('.lb-table b')).toBeNull();
    expect([...lb.el.querySelectorAll('.lb-initials')].some((c) => c.textContent === '<b>')).toBe(
      true,
    );
  });

  it('shows the empty state when there are no scores', async () => {
    const lb = createLeaderboard(document.body, {
      fetchScores: () => Promise.resolve({ ok: true, scores: [], now: 1000 }),
    });
    await lb.open();
    expect(lb.el.querySelector('.lb-status').textContent).toMatch(/no scores/i);
  });

  it('shows a not-configured state when the feature is disabled', async () => {
    const lb = createLeaderboard(document.body, {
      fetchScores: () => Promise.resolve({ ok: false, disabled: true }),
    });
    await lb.open();
    expect(lb.el.querySelector('.lb-status').textContent).toMatch(/not configured/i);
  });

  it('shows an error state when the fetch fails', async () => {
    const lb = createLeaderboard(document.body, {
      fetchScores: () => Promise.resolve({ ok: false }),
    });
    await lb.open();
    expect(lb.el.querySelector('.lb-status').textContent).toMatch(/offline|reach/i);
  });
});
describe('focus trap (ui/dom.js)', () => {
  // Every overlay focuses its PANEL on open so a screen reader announces the
  // dialog rather than a stray button. The panel has tabIndex -1, and
  // panel.contains(panel) is true, so a bare "is it inside?" test read that as
  // already-in-cycle and wrapped neither way: forward Tab survived by luck
  // (the panel precedes its children in document order), Shift+Tab walked out
  // of the modal into the page behind it.
  function fixture() {
    const before = document.createElement('button');
    before.textContent = 'behind the modal';
    const panel = document.createElement('div');
    panel.tabIndex = -1;
    const a = document.createElement('button');
    const b = document.createElement('button');
    panel.append(a, b);
    document.body.append(before, panel);
    return { before, panel, a, b };
  }
  const tab = (shiftKey) => ({ key: 'Tab', shiftKey, preventDefault: () => {} });

  it('wraps Shift+Tab from the panel itself to the LAST control', () => {
    const { panel, b } = fixture();
    panel.focus();
    trapTabKey(panel, tab(true));
    expect(document.activeElement).toBe(b);
  });

  it('sends forward Tab from the panel to the FIRST control', () => {
    const { panel, a } = fixture();
    panel.focus();
    trapTabKey(panel, tab(false));
    expect(document.activeElement).toBe(a);
  });

  it('still wraps at the real ends of the cycle', () => {
    const { panel, a, b } = fixture();
    b.focus();
    trapTabKey(panel, tab(false));
    expect(document.activeElement).toBe(a);
    a.focus();
    trapTabKey(panel, tab(true));
    expect(document.activeElement).toBe(b);
  });

  it('pulls focus back in from outside the panel', () => {
    const { before, panel, a } = fixture();
    before.focus();
    trapTabKey(panel, tab(false));
    expect(document.activeElement).toBe(a);
  });

  it('skips a control hidden by the `hidden` attribute', () => {
    const { panel, a, b } = fixture();
    a.hidden = true;
    b.focus();
    trapTabKey(panel, tab(false));
    expect(document.activeElement).toBe(b); // b is now both first and last
  });
});

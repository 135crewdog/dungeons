// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createHelp } from '../src/ui/help.js';
import { createLeaderboard } from '../src/ui/leaderboard.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('help overlay', () => {
  it('opens and closes and lists glyphs, stats, and controls', () => {
    const help = createHelp(document.body);
    expect(help.isOpen()).toBe(false);
    help.open();
    expect(help.isOpen()).toBe(true);
    const text = help.el.textContent;
    expect(text).toContain('Goblin');
    expect(text).toContain('Strength');
    expect(text).toContain('Numpad');
    // three tables: symbols, stats, controls
    expect(help.el.querySelectorAll('.help-table').length).toBe(3);
    help.close();
    expect(help.isOpen()).toBe(false);
  });

  it('Escape closes it', () => {
    const help = createHelp(document.body);
    help.open();
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(help.isOpen()).toBe(false);
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

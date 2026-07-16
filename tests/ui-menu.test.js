// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMenu } from '../src/ui/menu.js';

// A complete actions object so leaked window-keydown handlers from earlier
// tests (the overlay attaches to window and never detaches) never throw.
function makeActions(over = {}) {
  return {
    getSeed: () => 12345,
    canOpen: () => true,
    onOpen: vi.fn(),
    onNewRun: vi.fn(),
    onRestartSeed: vi.fn(),
    onLoadSeed: vi.fn(),
    onLeaderboard: vi.fn(),
    onHelp: vi.fn(),
    isChildOpen: () => false,
    ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('pause menu', () => {
  it('opens and closes, cancelling auto-walk via onOpen', () => {
    const actions = makeActions();
    const menu = createMenu(document.body, actions);
    expect(menu.isOpen()).toBe(false);
    menu.open();
    expect(menu.isOpen()).toBe(true);
    expect(actions.onOpen).toHaveBeenCalledOnce();
    expect(document.querySelector('#menu .menu-seed-val').textContent).toBe('12345');
    menu.close();
    expect(menu.isOpen()).toBe(false);
  });

  it('refuses to open when canOpen() is false', () => {
    const menu = createMenu(document.body, makeActions({ canOpen: () => false }));
    menu.open();
    expect(menu.isOpen()).toBe(false);
  });

  it('submitting the seed form routes the entered text through onLoadSeed', () => {
    const actions = makeActions();
    createMenu(document.body, actions);
    const input = document.querySelector('#menu .menu-seed-input');
    input.value = '  banana  ';
    document
      .querySelector('#menu [data-act="loadform"]')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    expect(actions.onLoadSeed).toHaveBeenCalledWith('banana'); // trimmed
  });

  it('New run and Restart route to their callbacks and close the menu', () => {
    const actions = makeActions();
    const menu = createMenu(document.body, actions);
    menu.open();
    document.querySelector('#menu [data-act="newrun"]').click();
    expect(actions.onNewRun).toHaveBeenCalledOnce();
    expect(menu.isOpen()).toBe(false);
    menu.open();
    document.querySelector('#menu [data-act="restart"]').click();
    expect(actions.onRestartSeed).toHaveBeenCalledOnce();
  });

  it('copies the seed to the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    createMenu(document.body, makeActions({ getSeed: () => 999 }));
    document.querySelector('#menu [data-act="copy"]').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('999');
  });

  it('a backdrop click closes the menu', () => {
    const menu = createMenu(document.body, makeActions());
    menu.open();
    // click on the overlay element itself (outside the panel) => resume/close
    menu.el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(menu.isOpen()).toBe(false);
  });

  it('Escape defers to a child overlay instead of closing itself', () => {
    let childOpen = true;
    const menu = createMenu(document.body, makeActions({ isChildOpen: () => childOpen }));
    menu.open();
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.isOpen()).toBe(true); // deferred while the child is up
    childOpen = false;
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.isOpen()).toBe(false); // now it handles the key
  });
});

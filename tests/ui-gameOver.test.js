// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGameOver } from '../src/ui/gameOver.js';

function makeOpts(over = {}) {
  return {
    isKeyboardBlocked: () => false,
    canSubmit: () => true,
    getLastInitials: () => '',
    onSubmitScore: vi.fn(() => Promise.resolve({ ok: true })),
    onShowLeaderboard: vi.fn(),
    ...over,
  };
}

const deadState = { floor: 7 };

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('game over overlay', () => {
  it('shows the reached floor and the initials form when submission is enabled', () => {
    const go = createGameOver(document.body, makeOpts());
    go.show(deadState, vi.fn());
    expect(go.el.classList.contains('show')).toBe(true);
    expect(go.el.querySelector('.go-sub').textContent).toContain('floor 7');
    expect(go.el.querySelector('.go-initials').style.display).not.toBe('none');
  });

  it('hides the initials form when submission is disabled', () => {
    const go = createGameOver(document.body, makeOpts({ canSubmit: () => false }));
    go.show(deadState, vi.fn());
    expect(go.el.querySelector('.go-initials').style.display).toBe('none');
  });

  it('sanitizes initials while typing (uppercase, A-Z0-9, max 3)', () => {
    const go = createGameOver(document.body, makeOpts());
    go.show(deadState, vi.fn());
    const input = go.el.querySelector('.go-initials-input');
    input.value = 'a-b!c9d';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(input.value).toBe('ABC');
  });

  it('submits once and then locks the form (one submission per death)', async () => {
    const opts = makeOpts();
    const go = createGameOver(document.body, opts);
    go.show(deadState, vi.fn());
    const input = go.el.querySelector('.go-initials-input');
    const form = go.el.querySelector('.go-initials');
    const submitBtn = form.querySelector('button');
    input.value = 'ZZ9';
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(opts.onSubmitScore).toHaveBeenCalledWith('ZZ9');
    // The lock IS the disabled input + button (a disabled submit button can't
    // fire again in the browser; the end-to-end guarantee is covered by E2E).
    expect(input.disabled).toBe(true);
    expect(submitBtn.disabled).toBe(true);
  });

  it('re-showing (a fresh death) unlocks the form', () => {
    const go = createGameOver(document.body, makeOpts());
    go.show(deadState, vi.fn());
    const input = go.el.querySelector('.go-initials-input');
    const submitBtn = go.el.querySelector('.go-initials button');
    input.disabled = true;
    submitBtn.disabled = true;
    go.hide();
    go.show(deadState, vi.fn());
    expect(input.disabled).toBe(false);
    expect(submitBtn.disabled).toBe(false);
  });

  it('does not submit invalid (short) initials', async () => {
    const opts = makeOpts();
    const go = createGameOver(document.body, opts);
    go.show(deadState, vi.fn());
    const form = go.el.querySelector('.go-initials');
    go.el.querySelector('.go-initials-input').value = 'AB';
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(opts.onSubmitScore).not.toHaveBeenCalled();
  });

  it('the New run button invokes the restart callback', () => {
    const go = createGameOver(document.body, makeOpts());
    const onRestart = vi.fn();
    go.show(deadState, onRestart);
    go.el.querySelector('[data-act="restart"]').click();
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it('autofocuses the initials field on death when submission is enabled', () => {
    const go = createGameOver(document.body, makeOpts());
    go.show(deadState, vi.fn());
    expect(document.activeElement).toBe(go.el.querySelector('.go-initials-input'));
  });

  it('does not autofocus a hidden form (submission disabled)', () => {
    const go = createGameOver(document.body, makeOpts({ canSubmit: () => false }));
    go.show(deadState, vi.fn());
    expect(document.activeElement).not.toBe(go.el.querySelector('.go-initials-input'));
  });

  it('announces submit status politely and traps Tab within the panel', () => {
    const go = createGameOver(document.body, makeOpts());
    go.show(deadState, vi.fn());
    expect(go.el.querySelector('.go-status').getAttribute('aria-live')).toBe('polite');
    // Tab from the last focusable (New run) wraps to the first (initials input).
    const restart = go.el.querySelector('[data-act="restart"]');
    restart.focus();
    const tab = new window.KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    restart.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(go.el.querySelector('.go-initials-input'));
  });
});

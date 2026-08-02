// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createUpdateNotice } from '../src/ui/updateNotice.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('update notice', () => {
  it('is silent until told — nothing rendered, nothing focusable', () => {
    const notice = createUpdateNotice(document.body);
    expect(document.getElementById('updatenotice')).toBe(notice.el);
    expect(notice.el.textContent).toBe('');
    expect(notice.el.children).toHaveLength(0);
    expect(document.querySelector('button')).toBe(null);
    expect(notice.isShown()).toBe(false);
  });

  it('announces by INSERTING into a live region that already exists', () => {
    // A live region has to be in the accessibility tree before the change it
    // reports, which is why the wrapper is permanent and the line is not.
    const notice = createUpdateNotice(document.body);
    expect(notice.el.getAttribute('aria-live')).toBe('polite');
    expect(notice.el.children).toHaveLength(0);
    notice.show();
    expect(notice.el.children).toHaveLength(1);
  });

  it('renders a real button naming its action', () => {
    // A platform <button> is where focusability and Enter/Space activation come
    // from — see the no-hand-rolled-keydown case below.
    const notice = createUpdateNotice(document.body);
    notice.show();
    const btn = notice.el.querySelector('button');
    expect(btn).toBe(notice.button);
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.type).toBe('button');
    expect(btn.textContent).toContain('Update');
    expect(notice.isShown()).toBe(true);
  });

  it('show() is idempotent — a repeat waiting event cannot re-announce', () => {
    const notice = createUpdateNotice(document.body);
    notice.show();
    notice.show();
    notice.show();
    expect(notice.el.children).toHaveLength(1);
  });

  it('applies once per click and reports that it is working', () => {
    const onApply = vi.fn();
    const notice = createUpdateNotice(document.body, { onApply });
    notice.show();
    notice.button.click();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(notice.button.disabled).toBe(true);
    expect(notice.button.textContent).toBe('Updating…');
  });

  it('a second click after applying is a no-op (never a second SKIP_WAITING)', () => {
    const onApply = vi.fn();
    const notice = createUpdateNotice(document.body, { onApply });
    notice.show();
    notice.button.click();
    notice.button.click();
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('adds no key handling of its own on top of the native button', () => {
    // Pins the decision: a keydown listener here would fire alongside the
    // platform's own Enter/Space activation, applying twice per press.
    const onApply = vi.fn();
    const notice = createUpdateNotice(document.body, { onApply });
    notice.show();
    notice.button.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('survives a missing callback', () => {
    const notice = createUpdateNotice(document.body);
    notice.show();
    expect(() => notice.button.click()).not.toThrow();
  });

  it('hide() empties the region and show() can raise it again', () => {
    const notice = createUpdateNotice(document.body);
    notice.show();
    notice.hide();
    expect(notice.isShown()).toBe(false);
    expect(notice.el.children).toHaveLength(0);
    notice.show();
    expect(notice.isShown()).toBe(true);
  });

  it('mounts into the given parent', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const notice = createUpdateNotice(host);
    expect(notice.el.parentElement).toBe(host);
  });

  it('does not steal focus when it appears', () => {
    // It can appear mid-fight; a focused button would put a Space press one
    // keystroke away from reloading the game.
    const notice = createUpdateNotice(document.body);
    notice.show();
    expect(document.activeElement).toBe(document.body);
  });
});

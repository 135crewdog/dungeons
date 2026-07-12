// Persistence for renderer-only user settings — currently just the art style
// (ASCII vs pixel). Phaser-free and imported only by the composition root
// (main.js): the renderer never reads storage, so it stays a pure observer of
// state that main.js hands it. Guards every localStorage access so private-mode
// / quota throws can't break boot, and never touches storage at import time so
// it loads cleanly in the node test env.

const KEY = 'dungeons:artStyle';

// Normalize any stored/unknown value to a known style. Default: 'ascii' (the
// intentional Phase-1 look), so a fresh player and any corrupt value both start
// in ASCII.
export function coerceArtStyle(raw) {
  return raw === 'pixel' ? 'pixel' : 'ascii';
}

export function loadArtStyle() {
  try {
    return coerceArtStyle(localStorage.getItem(KEY));
  } catch {
    return 'ascii';
  }
}

export function saveArtStyle(style) {
  try {
    localStorage.setItem(KEY, coerceArtStyle(style));
  } catch {
    // Ignore: storage unavailable (private mode) or over quota. The choice
    // still applies this session; it just won't be remembered.
  }
}

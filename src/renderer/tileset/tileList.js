// Parser for 0x72 Dungeon Tileset II's `tile_list_v1.7` — the atlas map that
// pairs each named frame with its rectangle in the combined 512x512 PNG. Each
// line is `name x y w h` (whitespace-separated). Pure and browser-free: the
// Phaser-side loader (loader.js) feeds the parsed rectangles to
// `texture.add(name, 0, x, y, w, h)` so every frame is addressable by name.
//
// The raw text is imported by the loader via Vite's `?raw`, keeping the atlas
// map bundled into JS (offline-safe) with no extra precache globs.

// Parse tile-list text into a Map of name -> { x, y, w, h } (all integers).
// Blank lines and malformed rows are skipped rather than throwing, so a stray
// newline never breaks asset loading.
export function parseTileList(text) {
  const frames = new Map();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 5) continue;
    const [name, x, y, w, h] = parts;
    const rect = { x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
    if (!name || Object.values(rect).some((n) => !Number.isFinite(n))) continue;
    frames.set(name, rect);
  }
  return frames;
}

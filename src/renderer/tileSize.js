// Tile → pixel size. This is a rendering concern: the simulation works purely in
// integer tile coordinates and never sees pixels, so the only place that needs
// to know a tile is 16×16 on screen is the renderer. Kept as a tiny leaf module
// so glyph drawing, the camera, and floating text share one source of truth.

export const TILE_SIZE = 16;

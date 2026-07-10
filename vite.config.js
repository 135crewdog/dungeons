import { defineConfig } from 'vite';

// Renderer bundle (Phaser) is large; keep the default esbuild minifier and let
// Vite hash asset filenames. The PWA plugin (Workbox precache) is wired in a
// later milestone. Vitest reads this same config; simulation tests run in a
// plain Node environment with no browser or Phaser instantiated.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});

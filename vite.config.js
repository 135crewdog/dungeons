import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// package.json is the single source of truth for the app version; it is
// injected as the compile-time constant __APP_VERSION__ (see src/ui/version.js).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Vite dev/build config. vite-plugin-pwa (Workbox) generates the manifest and a
// service worker that precaches the built app for full offline play, and
// registers it automatically (autoUpdate). Vitest reads this same config; the
// simulation tests run in a plain Node environment with no browser or Phaser.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon-64.png'],
      manifest: {
        name: 'Dungeons',
        short_name: 'Dungeons',
        description: 'A browser-based roguelike dungeon crawler.',
        theme_color: '#0b0d12',
        background_color: '#05060a',
        display: 'fullscreen',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
      },
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: true,
    // Phaser is a single large dependency; the warning is expected and noisy.
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});

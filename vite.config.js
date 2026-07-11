import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Vite dev/build config. vite-plugin-pwa (Workbox) generates the manifest and a
// service worker that precaches the built app for full offline play, and
// registers it automatically (autoUpdate). Vitest reads this same config; the
// simulation tests run in a plain Node environment with no browser or Phaser.
//
// ARCHIVE_BUILD produces the frozen Phase-1 ASCII "time capsule" (served at
// /ascii/): the PWA plugin is skipped so that build ships NO service worker and
// cannot fight the root app's SW over the /ascii/ scope. The archive is a
// self-contained static copy committed under public/ascii/.
const ARCHIVE_BUILD = !!process.env.ARCHIVE_BUILD;

const pwa = VitePWA({
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
    // The frozen ASCII archive under /ascii/ is a museum piece, not part of the
    // live app — keep it out of the root app's offline precache.
    globIgnores: ['ascii/**'],
  },
});

export default defineConfig({
  base: './',
  plugins: ARCHIVE_BUILD ? [] : [pwa],
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

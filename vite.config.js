import { copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// package.json is the single source of truth for the app version; it is
// injected as the compile-time constant __APP_VERSION__ (see src/ui/version.js).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// The game is GPLv3 (it bundles Shattered Pixel Dungeon art — see CREDITS.md),
// so the license and the attribution have to travel with the *distribution*,
// not just sit in the repository. They are copied verbatim into the build
// output; they stay out of the PWA precache on purpose (workbox's globPatterns
// don't match them — offline play doesn't need them).
const LEGAL_FILES = ['LICENSE', 'CREDITS.md'];

function copyLegalFiles() {
  let outDir = 'dist';
  return {
    name: 'copy-legal-files',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const root = fileURLToPath(new URL('./', import.meta.url));
      const dest = path.resolve(root, outDir);
      for (const file of LEGAL_FILES) {
        copyFileSync(path.join(root, file), path.join(dest, file));
      }
    },
  };
}

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
    copyLegalFiles(),
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
        // A precache entry with `revision: null` is never re-fetched while its
        // URL is unchanged — correct for a file whose NAME carries a content
        // hash, wrong for anything else.
        //
        // vite-plugin-pwa defaults this to /^assets/, i.e. "everything under
        // dist/assets/ is hashed". That is false here: the vendored SPD sheets
        // live in public/assets/ (Phaser loads them by runtime URL string, so
        // Vite never hashes them) and shipped revision-less. A re-vendored or
        // corrected sheet would therefore never reach an already-installed PWA —
        // and tests/entitySprites.test.js validates frame rects against the REPO
        // png, so such a change would pass CI while installed clients sampled
        // the old art.
        //
        // Match exactly what Vite hashes — a top-level `assets/name-[hash].js|css`
        // chunk — rather than "has a hyphen and some characters", which also
        // swallows `apple-touch-icon.png` and `icon-maskable-512.png` and merely
        // moves the bug to different files.
        //
        // Adding revisions is self-repairing: the same URL with a revision reads
        // as a changed entry, so the next service-worker update re-fetches those
        // sheets once and every later change propagates normally.
        // scripts/check-bundle.mjs fails the build if an unhashed URL ever goes
        // revision-less again.
        dontCacheBustURLsMatching: /^assets\/[^/]*-[A-Za-z0-9_-]{8}\.(js|css)$/,
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
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js', 'server/*.js'],
      // Excluded because they cannot execute outside a browser at all: the
      // composition root and the two modules that import Phaser. The e2e
      // campaign covers them. Everything else stays counted — including the
      // renderer modules that merely *take* a Phaser scene (spriteLayer,
      // glyphLayer, camera, floatingText). Those are testable with a fake
      // scene and mostly aren't, which is a real gap worth keeping visible
      // rather than excluding into invisibility.
      exclude: [
        'src/main.js',
        'src/renderer/phaserConfig.js',
        'src/renderer/GameScene.js',
        'server/worker.dashboard.js',
      ],
      reporter: ['text-summary', 'html', 'lcov'],
      // A floor, not a target: set a few points under the measured level so
      // ordinary work never trips it, and raise it when a change lands well
      // above. The point is to notice coverage FALLING, not to chase a number.
      //
      // "A few points" has to stay true to mean anything. lines/statements sat
      // at 75 against a measured 88.8 — nearly 14 points of slack, room for
      // hundreds of lines to go dark unnoticed, which is not a ratchet. Raised
      // to match branches/functions in tightness. Measured at 0.9.8: 88.8
      // lines / 88.8 branches / 90.5 functions / 88.8 statements.
      thresholds: { lines: 85, branches: 85, functions: 87, statements: 85 },
    },
  },
});

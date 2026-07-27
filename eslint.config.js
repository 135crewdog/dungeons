import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

// Flat ESLint config. Goal is a correctness ratchet — unused vars, undefined
// references, obvious mistakes — not style; Prettier owns formatting, and
// `prettier` (eslint-config-prettier) turns off every rule that would fight it.
export default [
  // Lint everything not generated: `npm run lint` runs bare `eslint .`, so this
  // list — not a glob in package.json — decides what is out of scope. Root
  // configs, e2e/*.mjs, and scripts/*.mjs are all real executable code and are
  // deliberately included.
  {
    ignores: [
      'dist/**',
      'dev-dist/**',
      'node_modules/**',
      'coverage/**',
      'e2e/.artifacts/**',
      'server/worker.dashboard.js', // generated; lint its sources instead
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // The repo spans browser (renderer/ui/input), Node (scripts/tests), and
      // Worker (server) code; allow the union of their globals rather than
      // splitting the config per directory.
      globals: {
        ...globals.browser,
        ...globals.node,
        __APP_VERSION__: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  prettier,
];

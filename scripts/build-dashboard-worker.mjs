// Generates server/worker.dashboard.js — the single-file build of the leaderboard
// Worker for pasting straight into the Cloudflare dashboard's code editor.
//
// It used to be maintained by hand, kept honest only by a behavioral parity
// test. That test catches a stale committed file but not a stale transform, and
// hand-inlining is exactly the kind of work a script should do. The modular
// files stay the source of truth; this flattens them.
//
// Run: node scripts/build-dashboard-worker.mjs   (--check to verify only)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SERVER = new URL('../server/', import.meta.url);
export const DASHBOARD_PATH = fileURLToPath(new URL('worker.dashboard.js', SERVER));

const BANNER = `// GENERATED FILE — do not edit by hand.
// Built from server/scores.js + server/worker.js by scripts/build-dashboard-worker.mjs.
// Single-file build of the leaderboard Worker, for pasting straight into the
// Cloudflare dashboard's code editor (no install, no build step, no imports).
// The modular files are the source of truth and are what the tests run against;
// regenerate this with \`npm run build:dashboard\` whenever they change.
`;

const read = (name) => readFileSync(new URL(name, SERVER), 'utf8');

// Drop the module plumbing: scores.js's named exports become plain
// declarations, and worker.js's import of them becomes nothing. `export
// default` on the worker object is kept — the dashboard editor expects a
// module worker.
// The trailing \n+ matters: leaving the import's blank line behind produces a
// double blank line, which Prettier would then reformat away — and a generated
// file that its own formatter disagrees with can never be byte-checked.
const stripNamedExports = (src) => src.replace(/^export (?!default)/gm, '');
const stripScoresImport = (src) =>
  src.replace(/^import \{[\s\S]*?\} from '\.\/scores\.js';\n+/m, '');

export function buildDashboardWorker() {
  const scores = stripNamedExports(read('scores.js')).trim();
  const worker = stripScoresImport(read('worker.js')).trim();
  return `${BANNER}\n${scores}\n\n${worker}\n`;
}

// `node scripts/build-dashboard-worker.mjs` writes; `--check` only compares, so
// CI can fail on a stale committed file without touching the tree.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const generated = buildDashboardWorker();
  if (process.argv.includes('--check')) {
    const current = readFileSync(DASHBOARD_PATH, 'utf8');
    if (current !== generated) {
      console.error('server/worker.dashboard.js is stale — run: npm run build:dashboard');
      process.exit(1);
    }
    console.log('server/worker.dashboard.js is up to date');
  } else {
    writeFileSync(DASHBOARD_PATH, generated);
    console.log(`wrote ${DASHBOARD_PATH}`);
  }
}

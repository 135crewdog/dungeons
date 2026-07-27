// Production bundle budget. Run after `npm run build`; fails if the shipped
// payload grows past its ceiling.
//
// The point is a regression tripwire, not a diet: Phaser is most of the bundle
// and that is a settled choice. What is NOT settled is silently drifting past
// it — vite's own chunk warning is raised to 2000 kB precisely because the
// expected size is large, which leaves nothing watching the real number.
//
// Source maps are excluded on purpose: they are published deliberately (see
// README), they are not downloaded during play, and at ~10 MB they would swamp
// any signal from the code itself.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

// Ceilings, in bytes. Set with headroom over the measured build so ordinary
// work never trips them; tighten if a change lands well under.
const BUDGET = {
  entryGzip: 400 * 1024, // largest JS chunk, gzipped — what a player downloads
  precache: 1800 * 1024, // everything the service worker stores for offline play
};

const KB = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(DIST);
} catch {
  console.error('no dist/ — run `npm run build` first');
  process.exit(1);
}

const scripts = files.filter((f) => f.endsWith('.js') && !f.endsWith('sw.js'));
if (scripts.length === 0) {
  console.error('dist/ has no JS — did the build fail?');
  process.exit(1);
}

// The entry chunk is the biggest one; sw.js/workbox are separate small files.
const entry = scripts
  .map((f) => ({ file: f, size: statSync(f).size }))
  .sort((a, b) => b.size - a.size)[0];
const entryGzip = gzipSync(readFileSync(entry.file)).length;

// Mirrors the workbox globPatterns in vite.config.js — what actually gets
// precached for offline play.
const PRECACHED = /\.(js|css|html|png|svg|ico|woff2)$/;
const precache = files
  .filter((f) => PRECACHED.test(f) && !f.endsWith('.map'))
  .reduce((sum, f) => sum + statSync(f).size, 0);

const checks = [
  { name: 'entry chunk (gzip)', actual: entryGzip, limit: BUDGET.entryGzip },
  { name: 'precache total', actual: precache, limit: BUDGET.precache },
];

let failed = false;
for (const { name, actual, limit } of checks) {
  const pct = Math.round((actual / limit) * 100);
  const over = actual > limit;
  failed = failed || over;
  console.log(`${over ? 'FAIL' : 'ok  '} ${name}: ${KB(actual)} / ${KB(limit)} (${pct}%)`);
}

if (failed) {
  console.error('\nBundle budget exceeded. Either trim the payload or raise the');
  console.error('ceiling in scripts/check-bundle.mjs — deliberately, in the commit');
  console.error('that needs it, so the growth is on the record.');
  process.exit(1);
}

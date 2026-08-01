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
//
// It also checks a correctness property of the generated service worker, not
// just a size: that no UNHASHED precache entry ships with `revision: null`.
// Such an entry is never re-fetched while its URL stays the same, so the file
// it points at can never be updated on an already-installed PWA.

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

// --- Precache revisions -----------------------------------------------------
//
// Workbox skips re-fetching an entry with `revision: null` as long as its URL is
// unchanged. That is right for a file whose NAME carries a content hash and
// wrong for everything else: the vendored SPD sheets sit under dist/assets/ with
// stable names, and vite-plugin-pwa's default `dontCacheBustURLsMatching`
// (/^assets/) used to exempt them, so a re-vendored sheet could never reach an
// installed client. vite.config.js narrows that to real Vite chunks; this is the
// assertion that keeps it narrow.
const HASHED = /^assets\/[^/]*-[A-Za-z0-9_-]{8}\.(js|css)$/;
let manifest = '';
try {
  manifest = readFileSync(join(DIST, 'sw.js'), 'utf8');
} catch {
  console.error('dist/sw.js missing — did the PWA plugin run?');
  process.exit(1);
}
const entries = [...manifest.matchAll(/\{url:"([^"]+)",revision:(null|"[^"]*")\}/g)];
if (entries.length === 0) {
  console.error('could not parse the precache manifest out of dist/sw.js');
  process.exit(1);
}
const unrevisioned = entries
  .filter(([, url, rev]) => rev === 'null' && !HASHED.test(url))
  .map(([, url]) => url);
if (unrevisioned.length > 0) {
  failed = true;
  console.log(`FAIL precache revisions: unhashed and revision-less — ${unrevisioned.join(', ')}`);
} else {
  console.log(
    `ok   precache revisions: ${entries.length} entries, only hashed chunks unrevisioned`,
  );
}

if (failed) {
  console.error('\nBundle budget exceeded. Either trim the payload or raise the');
  console.error('ceiling in scripts/check-bundle.mjs — deliberately, in the commit');
  console.error('that needs it, so the growth is on the record.');
  process.exit(1);
}

// Release metadata consistency. CLAUDE.md declares package.json's `version`
// the single source of truth for the app version — Vite injects it as
// __APP_VERSION__, the HUD and pause menu display it, and every leaderboard
// submission carries it.
//
// The lockfile records that same version in TWO places, and npm does not keep
// them in step on its own: nothing in `npm ci`, the build, or the tests reads
// them, so they drift silently. They sat at 0.9.5 across five releases before
// this check existed, which is exactly the kind of thing a policy without a
// gate turns into.
//
// This is metadata hygiene, not a runtime concern — no shipped code reads the
// lockfile. The point is that "one source of truth" is mechanically true
// rather than merely asserted.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8'));

const pkg = read('package.json');
const lock = read('package-lock.json');

const expected = pkg.version;
if (typeof expected !== 'string' || expected === '') {
  console.error('FAIL version: package.json has no usable "version" field');
  process.exit(1);
}

// Both lockfile locations npm writes the root package's version into. `npm
// install --package-lock-only` updates them together; a hand-edited bump
// usually misses one.
const sites = [
  ['package-lock.json → version', lock.version],
  ['package-lock.json → packages[""].version', lock.packages?.['']?.version],
];

const mismatched = sites.filter(([, actual]) => actual !== expected);

if (mismatched.length > 0) {
  console.error(`FAIL version: package.json says ${expected}, but:`);
  for (const [where, actual] of mismatched) {
    console.error(`       ${where} says ${actual === undefined ? '(missing)' : actual}`);
  }
  console.error('\nRun `npm install --package-lock-only` and commit only the version');
  console.error('fields, or edit them by hand. Bump every location together — the');
  console.error("app version is package.json's to define (see CLAUDE.md).");
  process.exit(1);
}

console.log(`ok   version: ${expected} in package.json and both package-lock.json roots`);

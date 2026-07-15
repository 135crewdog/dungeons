import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards that enforce the project's non-negotiable boundaries at test time:
// deterministic RNG only, a one-way simulation → renderer dependency, and
// networking confined to src/net + the composition root. Import checks match
// static (`from '...'`, `import '...'`), dynamic (`import('...')`), and
// CommonJS (`require('...')`) forms so they can't be dodged by changing the
// import style.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${name.name}`;
    if (name.isDirectory()) out.push(...jsFiles(rel));
    else if (name.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

function code(relPath) {
  // Strip comments so guards match real code, not prose about the rules.
  return readFileSync(join(ROOT, relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

// Every module specifier a file pulls in, whatever the import form.
function importPaths(src) {
  const out = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

const SIM_DIRS = ['src/core', 'src/world', 'src/entities', 'src/systems'];
const NON_RENDERER_DIRS = [...SIM_DIRS, 'src/ui', 'src/input', 'src/net'];
const ALL_DIRS = [...NON_RENDERER_DIRS, 'src/renderer'];
const MAIN = 'src/main.js';

const allSrcFiles = () => [...ALL_DIRS.flatMap(jsFiles), MAIN];

describe('architecture guards', () => {
  it('nothing under src/ calls Math.random() (single seeded RNG only)', () => {
    // The composition root's sanctioned randomness is crypto.getRandomValues
    // (startup seed); everything in gameplay flows through core/rng.js.
    for (const f of allSrcFiles()) {
      expect(code(f).includes('Math.random'), `${f} uses Math.random`).toBe(false);
    }
  });

  it('Phaser is imported only inside src/renderer (any import form)', () => {
    for (const f of [...NON_RENDERER_DIRS.flatMap(jsFiles), MAIN]) {
      const phaser = importPaths(code(f)).filter((p) => p === 'phaser');
      expect(phaser, `${f} imports phaser`).toHaveLength(0);
    }
  });

  it('fetch and localStorage live only in src/net and the composition root', () => {
    // CLAUDE.md: src/net is the only code allowed to fetch or touch
    // localStorage; main.js wires the real fetch/storage into the client.
    for (const dir of ALL_DIRS) {
      if (dir === 'src/net') continue;
      for (const f of jsFiles(dir)) {
        const src = code(f);
        expect(/\bfetch\s*\(/.test(src), `${f} calls fetch`).toBe(false);
        expect(/localStorage/.test(src), `${f} touches localStorage`).toBe(false);
      }
    }
  });

  it('the simulation never imports the network layer', () => {
    for (const dir of SIM_DIRS) {
      for (const f of jsFiles(dir)) {
        const net = importPaths(code(f)).filter((p) => /\/net\//.test(p));
        expect(net, `${f} imports src/net`).toHaveLength(0);
      }
    }
  });

  it('only the composition root imports the renderer', () => {
    for (const dir of NON_RENDERER_DIRS) {
      for (const f of jsFiles(dir)) {
        const renderer = importPaths(code(f)).filter((p) => /\/renderer\//.test(p));
        expect(renderer, `${f} imports the renderer`).toHaveLength(0);
      }
    }
  });

  it('the renderer imports only Phaser, its own modules, and read-only core', () => {
    // The renderer observes state; it must not be able to reach mutators
    // (gameState, turnEngine, movement, combat, ...) or the RNG. constants,
    // query, and events are the read-only vocabulary it is allowed to share.
    const allowed = [
      /^phaser$/,
      /^\.\//, // sibling renderer module
      /^\.\.\/core\/(constants|query|events)\.js$/,
    ];
    for (const f of jsFiles('src/renderer')) {
      for (const p of importPaths(code(f))) {
        const ok = allowed.some((re) => re.test(p));
        expect(ok, `${f} imports ${p} (outside the renderer allowlist)`).toBe(true);
      }
    }
  });
});

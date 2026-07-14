import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards that enforce the project's non-negotiable boundaries at test time:
// deterministic RNG only, and a one-way simulation → renderer dependency.

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

const SIM_DIRS = ['src/core', 'src/world', 'src/entities', 'src/systems'];
const NON_RENDERER_DIRS = [...SIM_DIRS, 'src/ui', 'src/input', 'src/net'];

describe('architecture guards', () => {
  it('gameplay code never calls Math.random() (single seeded RNG only)', () => {
    for (const dir of SIM_DIRS) {
      for (const f of jsFiles(dir)) {
        expect(code(f).includes('Math.random'), `${f} uses Math.random`).toBe(false);
      }
    }
  });

  it('no simulation or UI/input code imports Phaser', () => {
    for (const dir of NON_RENDERER_DIRS) {
      for (const f of jsFiles(dir)) {
        expect(/from\s+['"]phaser['"]/.test(code(f)), `${f} imports phaser`).toBe(false);
      }
    }
  });

  it('the simulation never talks to the network or browser storage', () => {
    // Networking lives in src/net (leaderboard) and is wired by the
    // composition root and UI only; the sim stays pure and deterministic.
    for (const dir of SIM_DIRS) {
      for (const f of jsFiles(dir)) {
        const src = code(f);
        expect(/from\s+['"][^'"]*\/net\//.test(src), `${f} imports src/net`).toBe(false);
        expect(/\bfetch\s*\(/.test(src), `${f} calls fetch`).toBe(false);
        expect(/localStorage/.test(src), `${f} touches localStorage`).toBe(false);
      }
    }
  });

  it('the input layer never imports the renderer', () => {
    for (const f of jsFiles('src/input')) {
      expect(/from\s+['"][^'"]*\/renderer\//.test(code(f)), `${f} imports renderer`).toBe(false);
    }
  });

  it('the renderer never imports the turn engine or mutates via systems', () => {
    // The renderer observes state + events only; it must not pull in the engine.
    for (const f of jsFiles('src/renderer')) {
      expect(/turnEngine/.test(code(f)), `${f} imports the turn engine`).toBe(false);
    }
  });
});

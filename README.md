# Dungeons

A browser-based roguelike dungeon crawler built with **Phaser** and vanilla
JavaScript, playable as an installable **offline PWA**. Rendered entirely in ASCII.
There is no scripted story — everything emerges from the systems and procedural
generation.

Descend through procedurally generated floors, fight monsters and bosses, collect
potions and treasure, and compete on the optional cross-device leaderboard.

## Features

- Procedurally generated floors (rooms + corridors + doors), different every run
- Symmetric-shadowcasting field of view with remembered (dimmed) terrain
- Two enemy types that wake on sight and hunt you with A\* pathfinding — and give up
  the chase when you break their line of sight (closed doors block sight, too)
- Bump-to-attack combat: d20 to-hit rolls, per-combatant damage dice, stackable
  stats, and floating damage or "Miss!" indicators
- Health potions and treasure chests with permanent bonuses or traps, plus persistent
  floors joined by up/down stairs —
  climb back up and the floor is exactly as you left it
- HUD with HP + floor number and a scrolling message log
- Permadeath: die, start a fresh run, or replay the same seed
- Deterministic: every run is driven by a single seed, logged to the console and
  available to copy or replace in the pause menu; reopen with `?seed=<value>` to replay it

## Controls

- **Move:** arrow keys or **WASD** (four directions); the **numpad** (1–9) adds
  diagonals.
- **Click / tap** anywhere on the map to auto-walk there along a path over
  explored ground. The walk stops if a new enemy appears, you take damage, or you
  press a key.
- Attack by moving into an enemy. Walk onto `>` to descend, `<` to ascend, onto
  `!` to drink, and onto `$` to open a chest.
- **Menu:** press **Escape** or select **Menu** in the upper-right corner to pause,
  copy or change the seed, and open the leaderboard or help.

Glyphs: `@` you · `#` wall · `.` floor · `+` door · `>` stairs down · `<` stairs up ·
`!` potion · `$` chest · `g` goblin · `s` skeleton · `B` boss.

## Getting started

```bash
npm install
npm run dev        # local dev server
npm run build      # production build to dist/
npm run preview    # serve the build (test the offline PWA here)
npm test           # run the unit tests (no browser needed)
npm run balance    # run the seeded headless balance simulator
```

## Reproducible runs

The seed for each run is printed to the browser console. To replay a specific run,
append it to the URL:

```
http://localhost:5173/?seed=123456789
```

## Architecture

The game is a deterministic **simulation** with a **renderer** on top, kept strictly
separate:

- The simulation owns all game state in a single object and exposes pure actions
  (`processCommand`, `resolveAttack`, `descend`, …). It uses integer tile
  coordinates only and never imports Phaser.
- The renderer observes state and the event list returned by each turn, then draws them.
  It never mutates simulation state. Phaser lives only in `src/renderer/`.

```
src/
  core/       turn engine, RNG, state, movement, queries, constants
  world/      dungeon generation (rooms, corridors, doors, stairs)
  entities/   player, enemies, items, spawning
  systems/    combat, pathfinding, fov, visibility, ai
  renderer/   all Phaser code (glyph grid, camera, floating text)
  ui/         HUD, message log, game-over, menu, leaderboard, help
  input/      keyboard + pointer
  net/        leaderboard client and browser-storage integration
```

`src/main.js` is the only module that wires the renderer to everything else.
`CLAUDE.md` is the full project briefing and the source of truth for the rules and
conventions.

## Tech

Phaser 3 · Vite · Vitest · vite-plugin-pwa (Workbox). Plain JavaScript, ES modules.

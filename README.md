# Dungeons

A browser-based roguelike dungeon crawler built with **Phaser** and vanilla
JavaScript, playable as an installable **offline PWA**. Rendered entirely in ASCII.
There is no scripted story — everything emerges from the systems and procedural
generation.

This is **Phase 1**: the complete core loop. Descend through procedurally generated
floors, fight two kinds of monsters, grab potions, and see how deep you can get
before you die.

## Features

- Procedurally generated floors (rooms + corridors + doors), different every run
- Symmetric-shadowcasting field of view with remembered (dimmed) terrain
- Two enemy types that wake on sight and hunt you with A\* pathfinding — and give up
  the chase when you break their line of sight (closed doors block sight, too)
- Bump-to-attack combat: 75% hit chance, floating damage / "Miss!" numbers
- Health potions (walk over to drink) and persistent floors joined by up/down stairs —
  climb back up and the floor is exactly as you left it
- HUD with HP + floor number and a scrolling message log
- Permadeath: die and restart a fresh run
- Deterministic: every run is driven by a single seed, logged to the console

## Controls

- **Move:** arrow keys or **WASD** (four directions); the **numpad** (1–9) adds
  diagonals.
- **Click / tap** anywhere on the map to auto-walk there along a path over
  explored ground. The walk stops if a new enemy appears, you take damage, or you
  press a key.
- Attack by moving into an enemy. Walk onto `>` to descend, `<` to ascend, onto
  `!` to drink.

Glyphs: `@` you · `#` wall · `.` floor · `+` door · `>` stairs down · `<` stairs up ·
`!` potion · `g` goblin · `s` skeleton.

## Getting started

```bash
npm install
npm run dev        # local dev server
npm run build      # production build to dist/
npm run preview    # serve the build (test the offline PWA here)
npm test           # run the unit tests (no browser needed)
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
- The renderer observes state + the event list each turn returns and draws it. It
  never mutates simulation state. Phaser lives only in `src/renderer/`.

```
src/
  core/       turn engine, RNG, state, movement, queries, constants
  world/      dungeon generation (rooms, corridors, doors, stairs)
  entities/   player, enemies, items, spawning
  systems/    combat, pathfinding, fov, visibility, ai
  renderer/   all Phaser code (glyph grid, camera, floating text)
  ui/         HUD, message log, game-over (DOM overlays)
  input/      keyboard + pointer
```

`src/main.js` is the only module that wires the renderer to everything else.
`CLAUDE.md` is the full project briefing and the source of truth for the rules and
conventions.

## Tech

Phaser 3 · Vite · Vitest · vite-plugin-pwa (Workbox). Plain JavaScript, ES modules.

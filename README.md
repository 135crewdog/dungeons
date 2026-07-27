# Dungeons

A browser-based roguelike dungeon crawler built with **Phaser** and vanilla
JavaScript, playable as an installable **offline PWA**. The dungeon renders from
Shattered Pixel Dungeon art: autotiled pseudo-3D walls from the prison tileset,
with the warrior, gnolls, skeletons, the evil Eye, and loot as animated SPD
sprites (classic ASCII one switch away). There is no scripted story — everything
emerges from the systems and procedural generation.

Descend through procedurally generated floors, fight monsters that grow with the
depth, loot chests, and see how deep you can get before you die — then put your
three initials on the cross-device leaderboard.

## Features

- Procedurally generated floors (rooms + corridors + doors), different every run
- **SPD sprite art** with SPD-style autotiling: stitched wall tops drawn over
  actors (pseudo-3D), two door orientations that swing open as you step through,
  per-cell floor variety — plus sprite creatures and items (warrior, gnoll,
  skeleton, the evil Eye as the boss, potion, golden chest), with the full ASCII
  look one switch away
- **Animation:** idle and walk cycles from the sheets' own frames, tile-to-tile
  move glides, attack lunges, and a camera locked to the player's sprite
- Symmetric-shadowcasting field of view with remembered (dimmed) terrain
- Goblins and skeletons that wake on sight and hunt you with A\* pathfinding — and
  give up the chase when you break their line of sight (closed doors block sight,
  too) · a **boss** guards the stairs on every 5th floor and drops a bonus chest
- Tabletop-style combat, two visible rolls per attack for every combatant: a **d20
  to-hit** (natural 1 always misses; `roll + skill ≥ 6`) then a **damage die +
  strength − armor** (a landed hit always deals at least 1); floating damage /
  "Miss!" numbers
- **Treasure chests** whose spawn-rolled contents stack for the run — +1 Strength,
  +1 Skill (accuracy), +1 Armor, +4 max HP, or a trap — and health potions (walk
  over to drink)
- **Depth scaling:** enemies climb a damage-die ladder (d4 → d10) and gain HP as
  you descend; floors grow more crowded; bosses roll d8/d12/d20 by lair tier
- Persistent floors joined by up/down stairs — climb back up and the floor is
  exactly as you left it
- HUD with HP, floor, and earned stats, plus a scrolling message log
- Permadeath: die and restart a fresh run — with arcade-style initials entry to a
  **30-day cross-device leaderboard** (offline submissions queue and send later).
  The board runs on the **honor system**: scores are self-reported by the client
  and are not verified, though every row stores the run's seed, so a submission
  could be replay-checked against the deterministic engine later
- Pause **menu** (Escape or the top-right "Menu" text) with seed tools, the
  leaderboard, and an in-game **help** page (glyphs, stats, controls)
- Deterministic: every run is driven by a single seed — logged to the console and
  shown in the pause menu with one-click copy; reopen with `?seed=<value>` to
  replay it

## Controls

- **Move:** arrow keys or **WASD** (four directions); the **numpad** (1–9) adds
  diagonals.
- **Click / tap** anywhere on the map to auto-walk there along a path over
  explored ground. The walk stops if a new enemy appears, you take damage, or you
  press a key.
- **Escape** (or the "Menu" text, top-right) opens the pause menu: new run,
  restart this seed, enter a seed, leaderboard, help.
- Attack by moving into an enemy. Walk onto the stairs to descend or ascend, onto
  a potion to drink it, onto a chest to open it (some are trapped).

Classic notation (and the ASCII-mode look): `@` you · `#` wall · `.` floor · `+`
door · `>` stairs down · `<` stairs up · `!` potion · `$` chest · `g` goblin ·
`s` skeleton · `B` boss.

## Getting started

```bash
npm install
npm run dev        # local dev server
npm run build      # production build to dist/
npm run preview    # serve the build (test the offline PWA here)
npm test           # run the unit tests (no browser needed)
npm run lint       # ESLint correctness ratchet
npm run format     # rewrite with Prettier (format:check verifies without writing)
npm run balance    # headless balance simulator (seeded bot runs, survival tables)
```

Before committing, run the quality gate — the same one CI runs:

```bash
npm run check        # lint + format:check + unit tests + build + bundle budget
npm run check:full   # the above plus the browser end-to-end campaign
```

The browser campaign needs a build and a Chromium binary, so it is not part of
`npm test`. If you don't have one:

```bash
npx playwright-core install chromium   # or set CHROMIUM_PATH to your own
npm run test:e2e
```

## Reproducible runs

The seed for each run is printed to the browser console and shown in the pause
menu. To replay a specific run, append it to the URL:

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
  renderer/   all Phaser code — sprite + ASCII terrain layers (spriteLayer,
              glyphLayer), pure autotiling (autotile), entity/item frame table
              and animation cycles (entitySprites), facing + move tweens
              (facing, motion), camera, floating text, DOM icon specs (uiIcons)
  ui/         HUD, message log, game-over, menu, leaderboard, help (DOM
              overlays); overlay.js is the shared modal factory, dom.js the
              small DOM/focus helpers
  input/      keyboard + pointer
  net/        leaderboard client — the only fetch/localStorage code
server/       Cloudflare Worker + D1 leaderboard backend (deployed separately)
```

`src/main.js` is the only module that wires the renderer to everything else.
`CLAUDE.md` is the full project briefing and the source of truth for the rules and
conventions.

## Credits

Environment tile art comes from **Shattered Pixel Dungeon** by Evan Debenham,
based on **Pixel Dungeon** by Watabou — GPLv3. See `CREDITS.md` for details.

## License

Copyright (C) 2026 135crewdog. Dungeons is free software under the **GNU General
Public License, version 3 or (at your option) any later version** — see
[`LICENSE`](LICENSE) for the full text and `CREDITS.md` for the notice.

The project is GPLv3 because it bundles Shattered Pixel Dungeon's artwork, which
is GPLv3 with no permissive carve-out; the same terms cover the original source,
the vendored art, and the app icons derived from it. Both `LICENSE` and
`CREDITS.md` are copied into the build output, so the deployed site carries them
as well.

Production builds ship **source maps deliberately**: the GPL already requires the
corresponding source to be available, so publishing maps costs nothing and makes
a live stack trace debuggable.

## Audits

Past engineering audits live under [`docs/audits/`](docs/audits), filed by date,
commit, and version. They are **historical snapshots** describing the commit each
one audited — not a statement about current `main`.

## Tech

Phaser 3 · Vite · Vitest · vite-plugin-pwa (Workbox). Plain JavaScript, ES modules.
Quality tooling: ESLint + Prettier, `@vitest/coverage-v8`, jsdom for the DOM
overlays, and playwright-core for the browser campaign — all wired into the one
`npm run check` gate that CI runs. The leaderboard backend is a tiny Cloudflare
Worker + D1 database in `server/` (see `server/README.md`); the game itself
deploys as static files.

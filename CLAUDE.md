# CLAUDE.md — Roguelike Project Briefing

This file is the single source of truth for the project and is read at the start of
every session. Keep it current as the project evolves.

We are building a browser-based roguelike dungeon crawler in **plain JavaScript** with
**Phaser.js** (rendering) and **Vite** (tooling), playable as an installable **offline
PWA**. Core philosophy: no scripted story, dialogue, or cutscenes — all meaning is
emergent from systems and procedural generation.

## Architecture: Simulation and Renderer Separation (non-negotiable)

Two completely independent layers:

- **Simulation** — all game logic and state (player position, enemy HP, dungeon
  layout, item locations, turn order, combat). It **never imports or calls Phaser**.
  It exposes pure actions such as `movePlayer(direction)`, `resolveAttack(attackerId,
  targetId)`, and `advanceTurn()`, and can be tested with no browser.
- **Renderer** — all Phaser code and visual output. It **observes** simulation state
  and draws it; it **never mutates** simulation state. Rendering never triggers
  gameplay logic.

This makes logic testable without a browser and lets visuals (ASCII ↔ sprites) swap
without touching game rules.

## State Ownership

There is a **single authoritative game-state object** owned by the simulation. All
systems (combat, pathfinding, AI, generation, fog of war) read from and write to that
one object. No system keeps a separate copy — this prevents synchronization bugs.

## Coordinate Conventions

The simulation uses **integer tile coordinates exclusively** — never pixels. The
renderer converts tile → pixel when drawing (tile size is fixed at **16×16**). The
simulation is unaware of pixels.

## Randomness and Seeding

All procedural generation and combat randomness go through **one seedable RNG
abstraction** (`mulberry32`), never `Math.random()` in gameplay code. A random seed is
generated at startup, stored on the game state, and **logged to the console** (decimal
+ base36) so any run can be reproduced. The seed is also shown in an on-screen chip
(top-right) that copies it to the clipboard on click; reopening the page with
`?seed=<value>` replays that run (a numeric URL seed is coerced back to a number so the
round-trip is exact).

## Turn Order (strict, every turn)

1. Receive and validate player input (keyboard, click, or tap).
2. Execute player movement or attack.
3. For each enemy in ascending entity-id order: move toward the player, then attack if
   adjacent.
4. Resolve item pickups (walking over items).
5. Update field of view and visibility.
6. Update HUD and message log.
7. Wait for the next player input.

## Movement and Pathfinding

8-directional movement (diagonals allowed).

- **Primary — click/tap.** Computes an A\* path to the destination using only tiles
  currently **known to be walkable** (unexplored tiles are treated as blocked). The
  path is stored and executed one tile per turn. It cancels automatically if a
  *newly*-visible enemy enters line of sight, the player takes damage, the path becomes
  invalid, or the player issues a new movement command. A click and a tap are identical.
- **Secondary — keyboard.** Arrow keys and WASD move one cardinal tile per keypress;
  the **numpad (1–9)** provides all 8 directions including diagonals.
- **Diagonals forbid corner-cutting:** a diagonal step is illegal unless both
  orthogonal tiles between it and the mover are passable. Same rule for player and AI.

## Field of View

**Symmetric shadowcasting.** Walls **and doors** block sight — a closed door is
walkable but opaque, so nothing (player or enemy) sees through a doorway until standing
in it. Each turn recompute currently-visible tiles. States: **visible** (fully lit) ·
**previously seen** (remembered, darkened) · **unexplored** (black). On first entering a
room, the entire room is marked **explored**.

## Combat

Moving adjacent to an enemy attacks it **immediately in that same turn** (no separate
attack turn; on a kill the player stays put). On its turn an enemy attacks if adjacent,
else moves toward the player. **Enemies aggro on sight** — they hold until the player
enters their line of sight, then give chase. A chasing enemy that **loses sight** of the
player heads for the tile it last saw them on; if it arrives empty-handed (or stays
blind for several turns) it **gives up** and holds position, re-aggroing only on a fresh
sighting — so breaking line of sight (e.g. slipping through a door) can shake pursuit.
Base hit chance **75%**: show a floating **"Miss!"** on a miss and a floating **damage
number** on a hit. Two entities never share a tile.

## Death

Permadeath. At 0 HP a minimal "You died" overlay appears; restarting begins a fresh run
on floor 1 with a **new random seed** (logged).

## Visual Style

**Phase 2** renders the game in **pixel art** using the CC0 **0x72 Dungeon Tileset II**
(committed at `src/assets/0x72_DungeonTilesetII_v1.7/`): a single combined atlas addressed by named
frames from its `tile_list`, plus the tileset's dedicated **low-wall autotile sheet**
(`atlas_walls_low-16x16.png`, a 3×3-minimal blob of 16×16 cells). Walls are driven from
that sheet — each wall tile picks a cell from its floor neighbours, so faces, vertical
edges, corners and corridor junctions all come from the art as intended. They read the
Shattered-Pixel-Dungeon way: viewed from the south, so a wall bordering floor to its south
shows a lit-capped brick FACE with a cast shadow below, while back walls are plain brick.
A plain floor tile is drawn UNDER every wall so the face's shadow lip and the room-side of
vertical walls show floor, never void (no floor/wall gaps). Floors have weighted variety;
the knight/goblin/skeleton are animated sprites (idle/run, plus hit for the hero) that
glide between tiles, flip to face travel, lunge on attack, flash when struck, and dissolve
on death. A torch pool of light follows the player; potions glow, pickups sparkle, stairs
shimmer. Fog is three states — visible (full colour) · previously seen (remembered, dim
tint) · unexplored (hidden).

**The sprite seam is `src/renderer/tileset/manifest.js`** (which frame/animation each
tile, entity and item maps to) and **`tileset/lowWalls.js`** (the wall autotile — the one
place mapping a neighbour config to a wall cell), plus `tileset/loader.js` (registers atlas
frames + anims). Swapping tilesets means editing those, not game logic. `?walldebug` lays
out all 48 low-wall cells with labels for re-decoding.

The original **Phase-1 ASCII** renderer is preserved as a frozen, playable build at
`/ascii/` (tag `v1-ascii`) — a time capsule, not the live style.

## Canvas and Resolution

Tile size fixed at 16×16. The viewport scales by showing **more tiles** on larger
screens, not larger tiles; the camera follows the player. **Integer scaling only**;
leftover space is neutral letterbox (no stretching). HUD elements anchor to screen
edges and adapt to any aspect ratio.

## Language and Tooling

Plain JavaScript, ES modules throughout. No TypeScript. No barrel/`index.js` files
unless they solve a clear current problem. Only runtime deps are **Phaser** and
**Vite**; **Vitest** and **vite-plugin-pwa** are dev/build tooling. Prefer simple,
readable code; favor composition; keep systems loosely coupled; avoid circular
dependencies.

## Project Structure

```
src/
  core/       // turn engine, game loop, rules, RNG, state, constants, queries
  world/      // dungeon generation (rooms, corridors, doors, stairs)
  entities/   // player, enemies, items, spawning
  systems/    // combat, pathfinding, fov, visibility, ai
  renderer/   // ALL Phaser code: TileLayer, SpriteEntity, fx, camera,
              //   floatingText, autotile, tileset/ (manifest, loader, tileList)
  ui/         // HUD, message log, game-over (DOM overlays)
  input/      // keyboard, mouse, touch
  assets/     // 0x72_DungeonTilesetII_v1.7/ — CC0 pixel-art atlas + tile_list (Phase 2 art)
```

The simulation layer is `core/`, `world/`, `entities/`, `systems/`. The renderer layer
is `renderer/` and `ui/`. `input/` bridges them by translating user actions into
simulation calls (it must not import the renderer). Only `src/main.js` imports the
renderer.

## Phase 1 Scope — build exactly this, then stop

Procedural dungeon generation (rooms + corridors, each floor different) · ASCII
rendering · click/tap A\* + keyboard movement · two enemy types with different HP/damage
that chase and attack · 75%-hit combat with floating numbers · health potions that
restore HP when walked over · **persistent floors** connected by down- and up-stairs
(floors are cached per run, so climbing back up returns to the same floor exactly as it
was left — layout, fog memory, items, and surviving enemies) · HUD (HP, floor number,
scrolling message log) · shadowcasting FOV with explored memory · installable offline
PWA. **Do not** implement inventory, equipment, leveling, save files, quests, or any
mechanic not listed here.

## Phase 2 Scope — visuals only

Phase 2 is a **renderer-only** upgrade from ASCII to pixel art: the 0x72 tileset,
2.5D autotiled walls, animated sprites, smooth tweened movement + camera follow,
combat animation (lunge / hit flash / death dissolve), and atmosphere (torch light,
potion glow, pickup sparkle, stairs shimmer). It adds **no** gameplay mechanics — the
simulation (`core/`, `world/`, `entities/`, `systems/`) is untouched, and all new code
lives in `src/renderer/`. The Phase-1 ASCII build is archived at `/ascii/`.

## Testing

Each major module has browser-free unit tests (Vitest). The simulation is kept
independent enough that dungeon generation, combat, pathfinding, and FOV are tested
without instantiating Phaser. The renderer's pure logic is tested too — `autotile`
(wall masks, floor hash), the `tileset/manifest` (frame + animation fallbacks), and
`tileset/tileList` parsing — all without a canvas. Determinism is guarded: no
`Math.random()` and no Phaser import under the simulation directories; renderer visual
randomness uses `Phaser.Math`, never the game RNG.

## PWA

`vite-plugin-pwa` (Workbox) generates the manifest + service worker: fullscreen
display, no orientation lock, precache of all built assets for full offline play, and
add-to-home-screen installability.

## Milestones

The build proceeds in small, independently runnable milestones (scaffold → RNG/state →
dungeon gen → renderer → keyboard/turn engine → FOV → enemies/combat → potions/stairs →
click pathfinding → HUD/game-over → responsive → PWA → polish), committing after each.

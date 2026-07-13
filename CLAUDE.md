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
+ base36) so any run can be reproduced. The current seed lives in the **pause menu**
(shown there with one-click copy), not in a standalone HUD chip; reopening the page with
`?seed=<value>` replays that run (a numeric URL seed is coerced back to a number so the
round-trip is exact). The active seed is kept in sync with the URL (`history.replaceState`,
no reload) whenever a run starts, so a refresh reproduces the current run.

## Pause Menu

A menu overlay opens by clicking/tapping the **"Menu" text** (top-right of the HUD, styled
like the HP/Floor readouts) or pressing the **Escape** key, and closes the same ways
(Escape, the Resume/× button, or clicking the backdrop). The game boots straight into
gameplay — the menu starts closed. While it is open the game is **paused** — the
composition root gates player input and cancels any in-progress auto-walk — and no turn
advances. Options: **Resume**, **New run** (fresh random seed), **Restart this seed**
(replay the current run from floor 1), and a **Seed** section that shows/copies the current
seed and lets the player paste a seed to regenerate its exact dungeon (routed through the
same `coerceSeed` + `restart` lifecycle as a `?seed=` URL). The menu is **also reachable
from the "You died" screen** (the Menu text stays above the death overlay; Escape works
too) so a dead player can copy the seed or retry the same dungeon. The menu is a DOM
overlay in `ui/` (like the HUD and game-over screen): it only reads the seed and invokes
composition-root callbacks, never mutating simulation state or importing the renderer. Its
look is deliberately plain and NetHack-ish so a future ASCII↔sprite art-style toggle can
slot into the options list.

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

Damage on a hit is `attacker damage + strength − target armor`, floored so a hit that
would deal >0 raw damage always lands for **at least 1** (armor never grants
invincibility; a 0-damage attack stays 0). The player's damage is flat (4 + strength);
**enemy damage is a d4 rolled fresh on every landed hit** through the seeded RNG
(rolled only after the 75% hit roll succeeds). Strength and armor are player stats
that start at 0 and stack via treasure chests.

**Goblin is the baseline enemy** (7 HP, d4 damage, full speed — the floor-1
reference). Skeletons are "about half a goblin": **4 HP** and **half movement speed**
— one tile every 2 turns (first step after aggro is immediate) — but they swing the
same d4 and still attack **every** turn when adjacent. A **boss** (`B`) guards the
down-stairs room on **every 5th floor**, full speed, same hit chance and
aggro/chase/give-up AI as everyone else; a slain boss always drops a bonus chest on
its death tile — ⅓ Strength / ⅓ Armor / ⅓ Health, never a trap.

**Depth scaling** (tuned with the headless balance simulator, `npm run balance` —
under identical careful bot play the floor-10 clear rate halved versus the old
numbers, and deaths spread across the whole descent instead of piling up at the boss
lairs): regular enemies gain **+1 max HP and +1 damage on every roll per 3 floors**
(a floor-7 goblin has 9 HP and hits for 3–6). **Floor population also scales**: the
enemy count gains +1 per 3 floors over its 5–8 base (capped at 12), and the spawn mix
drifts from 50/50 toward goblins by +3%/floor (capped at 80%). Bosses have their own
curve per lair tier (floor/5): **+12 max HP and +1 to the damage die multiplier per
tier** — floor 5: 26 HP at 2×d4, floor 10: 38 HP at 3×d4, floor 15: 50 HP at 4×d4 —
and are **exempt from the flat damage drip** (the multiplier is their damage scaling;
stacking both made deep lairs pierce armor twice over). Scaled stats are stamped on
the enemy instance at spawn, so cached floors keep their numbers.

## Death

Permadeath. At 0 HP a minimal "You died" overlay appears; restarting begins a fresh run
on floor 1 with a **new random seed** (logged).

## Visual Style

The entire game renders in **ASCII, monospace**. Floor `.` · Wall `#` · Player `@` ·
Enemies single letters (`g` goblin, `s` skeleton, `B` boss) · Potion `!` · Chest `$` ·
Stairs down `>` · Stairs up `<` · Door `+` · Unexplored space ·
Explored-but-not-visible: same glyph, darker. This is the
intentional art style, not a placeholder. The renderer is structured so sprites
could swap in later (`tileStyle.js` is the seam) without touching game logic.

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

## PR Watching

Whenever a session creates a pull request, or is asked to work on or monitor an
existing one, it must immediately subscribe to that PR's activity
(`subscribe_pr_activity`) and follow through on the events — respond to review
comments, fix CI failures — until the PR is merged or closed.

## Project Structure

```
src/
  core/       // turn engine, game loop, rules, RNG, state, constants, queries
  world/      // dungeon generation (rooms, corridors, doors, stairs)
  entities/   // player, enemies, items, spawning
  systems/    // combat, pathfinding, fov, visibility, ai
  renderer/   // ALL Phaser code only
  ui/         // HUD, message log, game-over (DOM overlays)
  input/      // keyboard, mouse, touch
assets/       // empty for now
```

The simulation layer is `core/`, `world/`, `entities/`, `systems/`. The renderer layer
is `renderer/` and `ui/`. `input/` bridges them by translating user actions into
simulation calls (it must not import the renderer). Only `src/main.js` imports the
renderer.

## Scope — build exactly this, then stop

Phase 1 (complete): procedural dungeon generation (rooms + corridors, each floor
different) · ASCII rendering · click/tap A\* + keyboard movement · two enemy types that
chase and attack · 75%-hit combat with floating numbers · health potions that restore
HP when walked over · **persistent floors** connected by down- and up-stairs (floors
are cached per run, so climbing back up returns to the same floor exactly as it was
left — layout, fog memory, items, and surviving enemies) · HUD (HP, floor number,
scrolling message log) · shadowcasting FOV with explored memory · installable offline
PWA. Phase 2 (pixel art) was skipped in favor of Phase 3 (complexity).

Phase 3a (complete): **treasure chests** (`$`, 1–2 per floor) that open when walked
over — contents rolled at spawn from the seeded RNG (current `CHEST_TABLE`): 30%
**+1 Strength** · 25% **+1 Armor** · 30% **+4 max HP + full heal** · 15% **trap**
(rolls 1–4 at spawn, like a goblin hit; armor applies, can kill). Bonuses stack for
the whole run and show in the HUD once earned · **enemy differentiation**: skeletons
at half movement speed with goblin baseline damage.

Phase 3b (complete): **per-attack damage dice** — enemies roll a d4 on every landed
hit (the player's damage stays flat) · **skeleton rebalance** ("half a goblin") ·
**boss enemies** — one boss on every 5th floor guarding the down-stairs room,
dropping a guaranteed no-trap bonus chest on death.

Phase 3c (complete): **depth scaling** — regular enemies gain max HP and flat damage
with depth; bosses escalate per lair (HP and damage-die multiplier per tier).
Constants in `core/constants.js` (`SCALE_*`, `BOSS_HP_PER_TIER`); scaling applied in
`createEnemy`.

Phase 3d (complete): **difficulty rebalance**, tuned empirically with a new
**headless balance simulator** (`npm run balance`, `scripts/balance/`) that drives
the real engine with two bot policies (thorough / stair-rusher) over hundreds of
seeded runs. Changes: goblin 7 HP · skeleton 4 HP · **enemy count depth scaling**
(+1 per 3 floors, cap 12) · **depth-weighted spawn mix** (goblin share 50% +3%/floor,
cap 80%) · chest table 30/25/30/15 with `CHEST_TABLE` thresholds · health chest +4 ·
boss 26 HP base, +12/tier, exempt from the flat damage drip. The current numbers in
the Combat section above are authoritative.

**Do not** implement inventory, equipment, leveling, save files, quests, or any
mechanic not listed here.

## Testing

Each major module has browser-free unit tests (Vitest). The simulation is kept
independent enough that dungeon generation, combat, pathfinding, and FOV are tested
without instantiating Phaser. Determinism is guarded: no `Math.random()` and no Phaser
import under the simulation directories.

Balance is guarded empirically: `npm run balance` runs the headless simulator
(`scripts/balance-sim.js`) — seeded bot-driven runs through the real engine that
report per-floor survival curves. Run it before and after touching any combat,
loot, or spawning constant; the before/after tables belong in the commit message.

## PWA

`vite-plugin-pwa` (Workbox) generates the manifest + service worker: fullscreen
display, no orientation lock, precache of all built assets for full offline play, and
add-to-home-screen installability.

## Milestones

The build proceeds in small, independently runnable milestones (scaffold → RNG/state →
dungeon gen → renderer → keyboard/turn engine → FOV → enemies/combat → potions/stairs →
click pathfinding → HUD/game-over → responsive → PWA → polish), committing after each.

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

- base36) so any run can be reproduced. The current seed lives in the **pause menu**
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
slot into the options list. **Leaderboard** and **Help** actions open child overlays that
layer _above_ the menu (z-index 30 vs the menu's 20) with the menu staying open
underneath; the menu's Escape handler defers while a child is open (`isChildOpen`
callback from the composition root), so one Escape press closes only the topmost layer.
Movement/tap input is gated while any of the three overlays is open.

## Leaderboard (cross-device, 30-day rolling)

The one networked feature. A tiny **Cloudflare Worker + D1** backend lives in
**`server/`** (worker.js + pure logic in scores.js + schema.sql + wrangler.toml),
deployed **manually once** via `npx wrangler deploy` (steps in `server/README.md`); the
game itself stays a static GitHub Pages deploy. API: `POST /scores` validates
`{ initials, floor, turns, seed, version }` (initials exactly 3 chars A–Z0-9, uppercased
server-side) and stamps a **server** timestamp; `GET /scores` returns the top 50 of the
last 30 days ordered **floor DESC, turns ASC, created_at ASC**, plus the server clock so
row ages ("3d ago") never trust the device clock. CORS is `*` (no credentials);
body-size cap and a best-effort per-IP rate limit blunt abuse. Anti-cheat is
honor-level, but every score carries its seed so a run could later be replay-verified
with the headless engine.

The client lives in **`src/net/`** — the only code allowed to fetch or touch
localStorage (the architecture test enforces that the sim never does either).
`src/net/config.js` holds `LEADERBOARD_URL`; **empty string = feature disabled** (the
death screen hides the initials form, the leaderboard view says "not configured", and
the game is otherwise unchanged). `createLeaderboardClient` takes injected
fetch/storage/clock so it tests in plain Node. Offline-first: a failed submit queues in
localStorage (`lb.queue`, cap 10, oldest dropped) and is flushed on boot and on the
`online` event; the last-used initials are remembered (`lb.initials`) and prefilled.

UI: on death the "You died" panel offers arcade-style 3-character initials entry
(sanitized while typing, **one submission per death** — the form locks after submit)
plus a Leaderboard button; the pause menu has Leaderboard too. The view renders
rank/initials/floor/version/age with loading/empty/offline/not-configured states, and
builds every cell with `textContent` since rows are other players' input.

## Help

A static menu-reachable overlay (`src/ui/help.js`): a glyph table (all eleven symbols,
playful one-liners), a stats table (HP/Floor/STR/ARM/SKILL), and a controls list, in the
same NetHack-ish panel style. It reads nothing and calls nothing back.

## Turn Order (strict, every turn)

1. Receive and validate player input (keyboard, click, or tap).
2. Execute player movement or attack.
3. Update field of view and visibility. (FOV depends only on walls + player
   position, so it is computed right after the player acts and is stable
   through the enemy phase — this is what gives enemies correct line of sight
   for same-turn aggro.)
4. For each enemy in ascending entity-id order: attack if adjacent, else move
   one step toward the player. (An enemy that closes to melee range this turn
   does **not** also attack this turn.)
5. Resolve item pickups (walking over items).
6. Update HUD and message log.
7. Wait for the next player input.

Stepping onto a staircase ends the turn immediately after the player's move:
the floor swaps and the enemy/pickup phases are skipped.

## Movement and Pathfinding

8-directional movement (diagonals allowed).

- **Primary — click/tap.** Computes an A\* path to the destination using only tiles
  currently **known to be walkable** (unexplored tiles are treated as blocked). The
  path is stored and executed one tile per turn. It cancels automatically if a
  _newly_-visible enemy enters line of sight, the player takes damage, the path becomes
  invalid, or the player issues a new movement command. A click and a tap are identical.
- **Secondary — keyboard.** Arrow keys and WASD move one cardinal tile per keypress;
  the **numpad (1–9)** provides all 8 directions including diagonals. Holding a
  movement key **repeats** at the OS key-repeat rate (each repeat is one discrete,
  synchronous turn) — intended hold-to-walk, classic-roguelike behavior, not a bug.
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
**Every attack is two visible rolls, identical for every combatant** (all through
the seeded RNG, tabletop style):

1. **To-hit** — roll a **d20**: a natural 1 always misses; otherwise the attack lands
   if `roll + skill ≥ 6` (75% at skill 0, +5% per skill point, capped at 95% by the
   natural-1 rule).
2. **Damage** — roll the attacker's **damage die + strength − target armor**, floored
   so a hit that would deal >0 raw damage always lands for **at least 1** (armor
   never grants invincibility; a 0-damage attack stays 0).

The message log stays plain language (`You hit the goblin for 5.`) — the to-hit
roll rides on the attack event/log data but is not narrated; the renderer floats a
**"Miss!"** or the **damage number** per swing. Skill, strength, and armor are
player stats that start at 0 and stack via treasure chests. The player rolls a
**d8** for damage. Two entities never share a tile.

**Goblin is the baseline enemy** (6 HP, d4 damage die, full speed — the floor-1
reference). Skeletons are "about half a goblin": **3 HP** and **half movement speed**
— one tile every 2 turns (first step after aggro is immediate) — but they roll the
same damage die and still attack **every** turn when adjacent. A **boss** (`B`)
guards the down-stairs room on **every 5th floor**, full speed, same to-hit rule and
aggro/chase/give-up AI as everyone else; a slain boss always drops a bonus chest on
its death tile — ⅓ Strength / ⅓ Armor / ⅓ Health, never a trap.

**Depth scaling — deeper monsters roll bigger dice** (tuned with the headless
balance simulator, `npm run balance`): regular enemies climb the damage-die ladder
**one rung per 4 floors** — floors 1–4 d4, 5–8 d6, 9–12 d8, 13+ d10 (clamped) — and
gain **+1 max HP per 2 floors**. **Floor population also scales**: the enemy count
gains +1 per 3 floors over its 5–8 base (capped at 12), and the spawn mix drifts
from 50/50 toward goblins by +3%/floor (capped at 80%). Bosses skip the ladder:
each lair tier (floor/5) rolls its own die — **floor 5: d8 (the player's own die),
floor 10: d12, floor 15+: d20** — and adds **+12 max HP per tier** over the 24 HP
base. Scaled stats are stamped on the enemy instance at spawn, so cached floors
keep their numbers.

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

## Versioning

**SemVer 0.x** while the game is in active development: bump the **minor** for each
completed phase, the **patch** for fixes and balance tweaks (retroactively, Phase 1 ≈
0.1.0 and Phases 3a–3f ≈ 0.3.1–0.3.6; the version display shipped as **0.4.0**).
`package.json`'s `version` field is the **single source of truth**; Vite injects it at
build time as the `__APP_VERSION__` constant (`define` in `vite.config.js`), read via
`src/ui/version.js` (falls back to `'dev'` outside Vite). It shows as a dim version
watermark (`v0.5.2` style) top-right on the row under the Menu text (kept apart from
the realtime gameplay stats) and in the pause-menu footer, so screenshots identify the
build — and it rides along on every leaderboard submission. Bump the version in the
same commit as the change it describes (Phase 4, the leaderboard + help release, was
**0.5.0**; `package.json` is always the current number).

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
  ui/         // HUD, message log, game-over, menu, leaderboard, help (DOM overlays)
  input/      // keyboard, mouse, touch
  net/        // leaderboard client — the only fetch/localStorage code; never
              // imported by the sim (architecture-test enforced)
assets/       // empty for now
server/       // Cloudflare Worker + D1 leaderboard backend (deployed separately)
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
over — contents rolled at spawn from the seeded RNG (current `CHEST_TABLE`): 25%
**+1 Strength** · 20% **+1 Skill** · 25% **+1 Armor** · 20% **+4 max HP + full
heal** · 10% **trap** (rolls 1–4 at spawn, like a floor-1 goblin hit; armor applies,
can kill). Bonuses stack for the whole run and show in the HUD once earned ·
**enemy differentiation**: skeletons at half movement speed with goblin baseline
damage.

Phase 3b (complete): **per-attack damage dice** — enemies roll a d4 on every landed
hit · **skeleton rebalance** ("half a goblin") · **boss enemies** — one boss on every
5th floor guarding the down-stairs room, dropping a guaranteed no-trap bonus chest on
death.

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
boss 26 HP base, +12/tier, exempt from the flat damage drip. _(The HP/chest numbers in
this changelog are the 3d-era values and were re-tuned again in 3f; the Combat section
above — goblin 6 HP, skeleton 3 HP, boss 24 HP base, chest table 25/20/25/20/10 — is
authoritative.)_

Phase 3e (complete, superseded by 3f): **player damage die** — the player rolled
d4+2 (+strength) per landed hit instead of a flat 4, making combat dice on both
sides.

Phase 3f (complete): **two-roll combat** — every attack is a visible **d20 to-hit
roll** (natural 1 misses; `roll + skill ≥ 6`) followed by a **damage-die roll**,
identical for all combatants; this deleted the flat hit chance, the player's d4+2,
the boss damage multiplier, and the flat depth-damage drip (the 3b/3e damage
formulas are superseded). Enemies scale by climbing the die ladder; bosses roll
d8/d12/d20 per tier; chests gained the **+1 Skill** effect (accuracy). Constants:
`HIT_DIE`/`HIT_THRESHOLD`, `PLAYER_ATTACK_DIE`, `ENEMY_DIE_LADDER` +
`DIE_LADDER_EVERY_FLOORS`, `BOSS_DICE`, five-way `CHEST_TABLE`. Simulator-retuned:
the careful bot's floor-10 clear rate stays ~14% (cross-validated), floor-1 deaths
~18%, boss share of deaths ~33% — the wide-dice lesson is that the min-1 armor
floor makes big dice pierce armor harder than their mean suggests, so die
assignments, not modifiers, carry the curve.

Phase 4 (complete): **cross-device leaderboard** (30-day rolling window, arcade
initials, Cloudflare Worker + D1 backend in `server/`, offline submission queue —
see the Leaderboard section) · **in-game Help page** (glyph/stat/control tables from
the menu). This is a deliberate exception to "offline and local": the sim remains
fully offline; only `src/net/` and the composition root know the network exists.

**Do not** implement inventory, equipment, leveling, save files, quests, or any
mechanic not listed here.

## Testing

Each major module has browser-free unit tests (Vitest). The simulation is kept
independent enough that dungeon generation, combat, pathfinding, and FOV are tested
without instantiating Phaser. Determinism is guarded: no `Math.random()` and no Phaser
import under the simulation directories — and no `fetch`, `localStorage`, or `src/net`
import there either (networking stays in `net/` + composition root). The leaderboard
worker is plain `fetch(request, env)` JS, tested in Node with a fake D1
(`tests/leaderboard-server.test.js`); the client tests inject fake fetch/storage
(`tests/leaderboard.test.js`).

Balance is guarded empirically: `npm run balance` runs the headless simulator
(`scripts/balance-sim.js`) — seeded bot-driven runs through the real engine that
report per-floor survival curves. Run it before and after touching any combat,
loot, or spawning constant; the before/after tables belong in the commit message.

## PWA

`vite-plugin-pwa` (Workbox) generates the manifest + service worker: fullscreen
display, no orientation lock, precache of all built assets for full offline play, and
add-to-home-screen installability. The service worker is precache-only — cross-origin
leaderboard calls pass through it untouched (no `runtimeCaching`), so the API needs no
PWA configuration and offline play is unaffected.

## Milestones

The build proceeds in small, independently runnable milestones (scaffold → RNG/state →
dungeon gen → renderer → keyboard/turn engine → FOV → enemies/combat → potions/stairs →
click pathfinding → HUD/game-over → responsive → PWA → polish), committing after each.

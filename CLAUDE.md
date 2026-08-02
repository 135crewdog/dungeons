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
(replay the current run from floor 1), **End run**, and a **Seed** section that shows/copies
the current seed and lets the player paste a seed to regenerate its exact dungeon (routed
through the same `coerceSeed` + `restart` lifecycle as a `?seed=` URL).

**End run** (0.9.6) stops the run where it stands and raises the score-submission screen —
the only way to post a score without dying for it. It **asks twice**: the first click only
arms it (the label becomes "Really end run?"), and the confirm is dropped whenever the menu
closes or the player reaches for any other action, so a half-pressed confirm can never
survive to fire on a later single click. The button is hidden once `canEndRun()` is false
(the menu is reachable from the end-of-run screen, where ending again is meaningless). It
routes through `gameState.endRun`, which sets `state.status = 'ended'` — see Death.

The menu is **also reachable
from the "You died" screen** (the Menu text stays above the death overlay; Escape works
too) so a dead player can copy the seed or retry the same dungeon. The menu is a DOM
overlay in `ui/` (like the HUD and game-over screen): it only reads the seed and invokes
composition-root callbacks, never mutating simulation state or importing the renderer. Its
look is deliberately plain and NetHack-ish so a future ASCII↔sprite art-style toggle can
slot into the options list. **Leaderboard** and **Help** actions open child overlays that
layer _above_ the menu (z-index 30 vs the menu's 20) with the menu staying open
underneath; the menu's Escape handler defers while a child is open (`isChildOpen`
callback from the composition root), so one Escape press closes only the topmost layer.
Movement/tap input is gated while any of the three overlays is open. The overlays
follow the modal a11y contract (via `ui/overlay.js` + `ui/dom.js`): Tab is trapped
inside the open dialog, focus returns to the opener on close, the death screen
autofocuses the initials field, and status lines are `aria-live` regions.

## Leaderboard (cross-device, 30-day rolling)

The one networked feature. A tiny **Cloudflare Worker + D1** backend lives in
**`server/`** (worker.js + pure logic in scores.js + schema.sql; its
**`wrangler.toml` sits at the repository root**, see below), deployed by
**Cloudflare Workers Builds from this repository** — a change under `server/`
that lands on `main` ships itself (steps and the one dangerous rule in
`server/README.md`); the game itself stays a static GitHub Pages deploy, so the
two halves deploy from the same push but by different pipelines. First green
build: `7b6cd46`, which is also the commit that fixed it — see the config-location
note below. API: `POST /scores` validates
`{ initials, floor, turns, seed, version }` (initials exactly 3 chars A–Z0-9, uppercased
server-side) and stamps a **server** timestamp; `GET /scores` returns the top 50 of the
last 30 days ordered **floor DESC, turns ASC, created_at ASC**, plus the server clock so
row ages ("3d ago") never trust the device clock. `GET /health` (0.9.11) answers which
build is live and whether it can reach its data: the deployment id and timestamp from
Cloudflare's `[version_metadata]` binding — automatic, so it cannot drift the way a
hand-kept version string does — a real D1 probe, and the table's **row count**, which
is the only field that distinguishes the right database from a schema-compatible wrong
one. It closes issue #30 (confirming the worker serves current code), and it is
deliberately not a schema-version table with migrations: more apparatus than this earns.
The API uses no cookies or
credentials, and ships configured with `ALLOWED_ORIGIN = "*"` (see the hardening
paragraph below for what that variable now does). The board is
**deliberately an honor system** — a settled decision, not a gap awaiting a fix: the
client asserts its own floor/turns and the server takes them on trust, and the READMEs
say so in as many words rather than implying a verification that isn't there. The
**overlay itself carries no disclaimer** (0.9.10 removed the footer it shipped with in
0.9.4): the trust model is documented, not something to re-explain to the player every
time they open the board. Every score still carries its seed, so a run could
later be replay-verified with the headless engine if that ever becomes worth doing.

Server hardening (0.9.5): CORS **fails closed** — a missing `ALLOWED_ORIGIN` is a
misconfiguration, not a wildcard, so it emits no CORS headers at all; the var takes
`*` (what ships) or a comma-separated origin allowlist, echoed back with
`Vary: Origin`. The per-IP rate-limit map is **bounded** (expired stamps pruned,
key count capped) and 429s carry `Retry-After`. Body limits are measured in real
**bytes**, `Content-Length` is checked before the body is read, and POST requires a
JSON content type. D1 failures are caught and normalized into a JSON 500 with CORS
and `no-store` (logging `CF-Ray`, never the payload) instead of escaping as an
opaque crash. An identical `(initials, floor, turns, seed)` inside 10 minutes is
refused **409** — mostly the offline queue re-sending a score whose response was
lost. `server/worker.dashboard.js` is **generated** from `scores.js` + `worker.js`
(`npm run build:dashboard`), guarded by both a byte-identity check and the
behavioral parity battery; since the Git connection it is a **fallback** for
deploying without one, not the normal route.

**The rule that makes the Git deploy safe** (0.9.9): a deploy makes the live
worker match `wrangler.toml`, **replacing** the dashboard's vars and bindings. So
`database_id` must be the real database's id — a placeholder detaches the worker
from its data and every request returns `500 storage unavailable` — `ALLOWED_ORIGIN`
is owned by the file, not the dashboard, and `workers_dev = true` is stated
explicitly because `LEADERBOARD_URL` is a `*.workers.dev` address and an unstated
value could switch it off. Schema changes are the
one thing NOT automatic: a pipeline ships code, not migrations, so `schema.sql`
is applied by hand in the D1 console (it is `CREATE ... IF NOT EXISTS`
throughout, so re-running it is safe).

**Why `wrangler.toml` is at the repository root, not in `server/`** (0.9.9):
Workers Builds looks for a Wrangler config in the build's **root directory**
(default: the repo root) and **rejects the build before it starts** when it finds
none. That is what four consecutive failed builds were; moving the file fixed it
on the first attempt. (The GitHub check run's timestamps do NOT show this — a
successful 15-minute build reports the same start and finish second as an instant
rejection, so they carry no duration at all. `server/README.md` records that trap.)
Keeping the config where the tooling already looks makes the deploy work
on Cloudflare's **default** settings, with nothing to configure in the dashboard;
`main = "server/worker.js"` points back at the code. It is the **only** Wrangler
config in the repo, deliberately — a second one under `server/` would drift, and
the loser would be whichever a deploy doesn't read.

The client lives in **`src/net/`** — the only code allowed to fetch or touch
localStorage (the architecture test enforces that the sim never does either).
`src/net/config.js` holds `LEADERBOARD_URL`; **empty string = feature disabled** (the
death screen hides the initials form, the leaderboard view says "not configured", and
the game is otherwise unchanged). `createLeaderboardClient` takes injected
fetch/storage/clock/timers so it tests in plain Node. Offline-first: a failed submit
queues in localStorage (`lb.queue`, cap 10, oldest dropped, stored under a version
envelope); the last-used initials are remembered (`lb.initials`) and prefilled.
Failures are **classified** (0.9.5): only _retryable_ ones queue — network, timeout,
408/425/429, 5xx — while a permanent 4xx (including the server's duplicate 409) is
reported and dropped, and the flush **skips past** a permanently-rejected entry
instead of letting it block every later score forever. Both requests carry a
**timeout** (raced in the client, so a fetch that ignores its signal still can't hang
the death screen).

The queue drains on boot, on `online`, on `visibilitychange` back to visible, and —
since 0.9.11 — on **its own backoff timer**: 10s doubling to a 5-minute cap, reset the
moment the queue empties, cancelled on `pagehide`. Before that timer existed, a
retryable failure while the tab stayed _online_ (a 500, a D1 outage, a timeout) had no
delivery path at all short of a reload, which made the death screen's "will send
later" a wish. There is **no jitter**, deliberately: jitter decorrelates a fleet of
clients, this is one tab draining its own queue, and it would mean `Math.random()`
under `src/`, which the architecture test forbids. A `Retry-After` **extends** the
wait and never shortens it, only a _retryable_ status may arm it, and `submit()`
honors it by queueing rather than POSTing into a backoff the server just asked for.

`fetchScores` **validates the response shape** at the boundary (object body, `scores`
an array within a sane cap, finite `now`); anything else is `invalid-response` and the
overlay shows its normal failure state rather than letting a body that merely parses
reach a view that calls `.forEach` on it. The device-clock fallback for a missing
`now` was removed with it: our server always sends one, so its absence means the
response is not ours, and dating other players' rows off an unsynced local clock is
the exact thing the server clock exists to prevent.

UI: on death the "You died" panel offers arcade-style 3-character initials entry
(sanitized while typing, **one submission per death** — the form locks after submit)
plus a Leaderboard button; the pause menu has Leaderboard too. The view renders
rank/initials/floor/version/age with loading/empty/offline/not-configured states, and
builds every cell with `textContent` since rows are other players' input.

## Help

A static menu-reachable overlay (`src/ui/help.js`), **sprite-first**: the legend shows
the real sheet art (four legend sections — Denizens / Loot / Rings / Dungeon — plus
Stats, **Rules** and Controls tables, seven in all) with playful one-liners; glyph
notation no longer appears anywhere in the UI. **Rules** (0.9.11) is where the
surprising and irreversible mechanics are stated plainly — stair-avoiding auto-walk,
one swing per enemy click, numpad-only diagonals and the corner rule, the Ring of
Speed's forfeits, the Ring of Shadow's noise through walls, the d20 to-hit and the
minimum-1 damage floor — because none of them were learnable inside the installed
offline app. Tuned numbers (radii, spawn weights) stay out: how a thing behaves is
the player's business, how it is balanced is not. The icons are CSS crops of the public sprite sheets, built by an `iconFor`
factory that **the composition root injects** (`src/renderer/uiIcons.js` holds the
pure specs; `ui/` never imports `renderer/`, so main.js is the bridge — the HUD's
key/ring chips take the **same `iconFor` seam**, which since 0.9.4 hands over an
**Element**, never an HTML string). Without the injection the rows fall
back to name-only text. The panel scrolls inside itself on short screens. It reads
nothing and calls nothing back.

## Turn Order (strict, every turn)

1. Receive and validate player input (keyboard, click, or tap).
2. Execute player movement or attack.
3. Update field of view and visibility. (FOV depends only on walls + player
   position, so it is computed right after the player acts and is stable
   through the enemy phase — this is what gives enemies correct line of sight
   for same-turn aggro.) Hidden keys within `KEY_REVEAL_RADIUS` **and** in FOV
   reveal right after the FOV update — before enemies act and before pickups,
   so stepping blindly onto a hidden key reveals then collects it in one turn.
4. For each enemy in ascending entity-id order: attack if adjacent, else move
   one step toward the player. (An enemy that closes to melee range this turn
   does **not** also attack this turn.)
5. Resolve item pickups (walking over items).
6. Update HUD and message log.
7. Wait for the next player input.

**One successful player command consumes exactly one turn**, counted in
`processCommand` the moment the action lands — before anything else. An invalid
or blocked command consumes nothing. Stepping onto a staircase ends the turn
immediately after the player's move: the floor swaps and the enemy/pickup phases
are skipped, but the turn **still counts** (it was a real action, and `state.turn`
is the leaderboard's tie-break — until 0.9.4 stair steps were free, which
silently flattered every score that used stairs).

**Ring of Speed** grants a second step per movement turn, inserted between
steps 2 and 3 with its own FOV/reveal pass so the intermediate tile is
explored honestly. Invariants: a bump-attack consumes the whole turn; the
second step repeats the first step's direction, never attacks (silently
skipped when blocked or occupied), is forfeited when the first step lands on
stairs (floor swaps immediately) or on an item ("you stop over loot" — this is
what keeps pickups un-skippable); `state.turn` still advances once per
command; the enemy phase and pickups run once, at the final position. Commands
carry an optional `single: true` to opt out of the doubling (auto-walk path
corners, attack pursuit, and the balance bots use it).

## Movement and Pathfinding

8-directional movement (diagonals allowed). Corridors are single-tile-wide and cut
deterministically (no per-corridor RNG), so aligned rooms share one clean hall instead of
scattering into double-wide/parallel runs; loop corridors beyond the spanning tree are kept
only when they are genuine shortcuts (endpoints far apart in the corridor graph), and rooms
that sit exactly one wall apart are linked by a single door. Rooms are also placed clustered
(`MAX_NEIGHBOR_GAP`) so no connector spans an empty quarter of the map.

- **Primary — click/tap.** Computes an A\* path to the destination using only tiles
  currently **known to be walkable** (unexplored tiles are treated as blocked). The
  path is stored and executed one tile per turn. It cancels automatically if a
  _newly_-visible enemy enters line of sight, the player takes damage, the path becomes
  invalid, or the player issues a new movement command. A click and a tap are identical.
  Clicking a **visible enemy** is an **attack intent** instead: the path re-aims at the
  enemy's current tile every turn (so a moving target is tracked, not chased to a stale
  tile) and on reaching melee range the player lands **one bump attack and stops** — one
  swing per click; clicking an already-adjacent enemy is a single swing. The same
  cancellation rules apply while closing in, with one carve-out: damage taken on the very
  step that reached melee doesn't abort (enemies strike the moment the player arrives, and
  the swing is the next action). Losing the target — dead or out of sight — also ends the
  pursuit. Clicking a tile that holds a _non_-visible enemy is a plain walk.
- **The click path routes around staircases** (0.9.7). Stepping onto one swaps the floor
  immediately, so a staircase that merely happens to lie between the player and where
  they clicked used to end the floor by accident. `planPath` now runs a stair-free A\*
  pass first, with the **clicked tile exempt** — clicking the stairs is still how you
  take them, and an enemy standing on them is still a legal attack target. When no
  stair-free route exists at all (a staircase in a one-wide chokepoint) the fallback
  pass is **truncated before the staircase**: the walk goes as far as the tile in front
  of it and stops, so changing floors always costs a second, deliberate command. A path
  with nothing left after truncation is refused outright rather than shuffling one tile.
  Keyboard steps are untouched — the rule lives in the planner, not in what a step may
  do. Because the same A\* predicate feeds `diagonalAllowed`, a diagonal squeezing past
  a staircase corner is refused and the route detours a tile; harmless, and exactly what
  enemies have always done.
- **Ring of Speed and auto-walk.** With the ring on, a plain walk consumes two
  **colinear** path nodes per turn and lets the engine double the step; at a path
  corner the controller forces `single: true` (the engine's doubling can only repeat
  a direction). If the engine forfeits the second step (loot underfoot, occupied
  tile), the controller detects the one-tile-short landing, **rewinds the path
  cursor**, and carries on instead of cancelling. Attack pursuit always sends
  `single: true` — precision over pace while closing in.
- **Secondary — keyboard.** Arrow keys and WASD move one cardinal tile per keypress;
  the **numpad (1–9)** provides all 8 directions including diagonals. Holding a
  movement key **repeats** at the OS key-repeat rate (each repeat is one discrete,
  synchronous turn) — intended hold-to-walk, classic-roguelike behavior, not a bug.
- **Diagonals forbid corner-cutting:** a diagonal step is illegal unless both
  orthogonal tiles between it and the mover are passable. Same rule for player and AI,
  and the same rule for **melee reach** — see Combat.
- **Enemies route around stairs and items.** An enemy can't use stairs or collect
  potions/chests, so it treats those tiles as obstacles and paths around them — stepping
  onto one only when boxed in (the sole route to the player runs over it), so a player can't
  hide behind a potion. The **item** half stays enemy-only (the player wants to walk over
  loot); since 0.9.7 the **stairs** half is shared with the player's click planner, though
  each applies it through its own A\* predicate and with its own boxed-in fallback —
  enemies cross the staircase, the player stops in front of it. Neither narrows the shared
  `isWalkable`, so a deliberate step onto a staircase always works.

## Field of View

**Symmetric shadowcasting.** Walls **and doors** block sight — a closed door is
walkable but opaque, so nothing (player or enemy) sees through a doorway until standing
in it. Each turn recompute currently-visible tiles. States: **visible** (fully lit) ·
**previously seen** (remembered, darkened) · **unexplored** (black). On first entering a
room, the entire room is marked **explored**.

## Combat

Moving adjacent to an enemy attacks it **immediately in that same turn** (no separate
attack turn; on a kill the player stays put). On its turn an enemy attacks if in melee
reach, else moves toward the player.

**Melee reach obeys the corner rule** (`meleeReachable` in `core/query.js`): adjacent
**and** not reaching diagonally past a wall corner — the same `diagonalAllowed` test a
diagonal step must pass, so both sides of a fight share one definition of "close enough
to swing". The player's bump attack always obeyed it (it routes through `tryMove` →
`canStep`); enemies used bare Chebyshev adjacency until 0.9.2, which let one standing
kitty-corner through a wall hit a player who could not hit back. An enemy pinned by a
corner paths around it instead. Closing that gap was a **significant** difficulty change
— the thorough bot's floor-10 clear rate went 30% → 50%, so those free corner hits were
carrying real weight in the curve — and 0.9.3 re-tuned against it by raising base enemy
HP to 7/4 (see the depth-scaling paragraph), landing floor-10 clear back at ~33%.

**Enemies aggro on sight** — they hold until the player
enters their line of sight, then give chase. A chasing enemy that **loses sight** of the
player heads for the tile it last saw them on; if it arrives empty-handed (or stays
blind for several turns) it **gives up** and holds position, re-aggroing only on a fresh
sighting — so breaking line of sight (e.g. slipping through a door) can shake pursuit.
A player swing is also **loud**: hit or miss, it marks every enemy within
`SHADOW_NOISE_RADIUS` of the player as `provoked`, through walls. That flag is read only
by the Ring of Shadow's gate (see Secrets), so it changes nothing for a ringless run.
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

**Goblin is the baseline enemy** (7 HP, d4 damage die, full speed — the floor-1
reference). Skeletons are "about half a goblin": **4 HP** and **half movement speed**
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
on floor 1 with a **new random seed** (logged). The one exception: an armed **Ring of
Survival** fires at the moment HP would hit 0 (both lethal sites — enemy hits and
chest traps), restoring **`SURVIVAL_HEAL_FRACTION` of max HP (half, rounded up, never
below 1)** and crumbling to dust. It works once; a later Survival ring re-arms it. It
restored FULL HP until 0.9.6, which made the cheated death cost nothing — you walked
away from a lethal blow healthier than most fights leave you.

A run can also end **voluntarily**, from the pause menu's **End run**. `gameState.endRun`
sets `state.status = 'ended'`; the same overlay appears, titled **"Run ended"** rather
than "You died", and submits an identical leaderboard payload. `'ended'` is a distinct
status rather than a reuse of `'dead'` because the two must be told apart downstream, and
a parallel "was it voluntary" flag would be a second source of truth for one fact. It
costs nothing to add: every guard in the turn engine and controller is written
`!== 'playing'`, so they freeze the world for `'ended'` unchanged. `endRun` consumes no
turn and draws no RNG — stopping is not an action.

## Secrets (Phase 7)

Each **5-floor band** (1–5, 6–10, …) hides exactly one **key** and one **locked
chest** holding a magic ring, always on different floors: the key strictly earlier,
so the natural descent meets it first (miss it and you can climb back — floors
persist). WHICH floors host them and WHICH ring the chest holds derive from a pure
per-band hash of the run seed (`src/world/secrets.js` — `secretPlan(seed, band)`,
never the main RNG stream, so any floor's plan is computable in isolation); WHERE on
the floor uses the main RNG like every other spawn. Constants: `SECRET_BAND_FLOORS`,
`KEY_REVEAL_RADIUS`, `SPEED_STEPS`, `SHADOW_NOISE_RADIUS`, `SHADOW_NOTICE_RADIUS`,
`SURVIVAL_HEAL_FRACTION`, `RING`/`RING_TYPES`/`RING_FLAG`.

- **The key** spawns `hidden` (never rendered, not even dimmed) in a non-start room
  and reveals with "A glimmer catches your eye." when the player is within 2 tiles
  **and** the tile is in FOV (no glimmers through walls or closed doors — and the
  Ring of Sight does NOT reveal keys). Walking over it banks it on the player
  (`player.keys` — interchangeable across bands, HUD chip, survives floor swaps since
  the player object is carried by reference).
- **The locked chest** is visibly a different chest (blue crystal vs. the golden
  regular chest). Keyless, it announces "locked" once per arrival and never opens.
  With a key it consumes one and **drops its ring on an adjacent floor tile**
  (deterministic DIRS8 scan over `query.canDropAt`, boss-chest style — **never a
  doorway**, see below; if boxed in, the ring goes straight onto the finger).
- **The four rings** are passive, auto-worn on walk-over, kept for the run
  (`restart` wipes them), shown as HUD gem chips, one per band in a seed-shuffled
  cycle (bands 0–3 all differ; deeper bands wrap — a duplicate permanent ring is a
  no-op, a duplicate Survival ring re-arms):
  - **Sight** — the whole floor renders fully lit and `explored` fills (full-floor
    click pathing). Presentation reads `query.isRevealed`; the sim's `visible` array
    stays strictly shadowcast, so **enemy aggro still requires true line of sight**
    (no floor-wide dinner bell) and auto-walk cancel semantics are unchanged.
  - **Shadow** — invisible **per-enemy**, with three ways for cover to break. The rule
    is ONE exported predicate, **`hiddenFromEnemy` in `core/query.js`** — `ai.js` gates
    sighting on it and the headless balance bot reads the same function, so the two
    cannot drift (the bot used to mirror the expression by hand):
    - **Noise** — a player swing, hit _or_ miss, sets `provoked` on the target **and on
      every enemy within `SHADOW_NOISE_RADIUS` (5) of the player**, deliberately
      **through walls**: it is sound, not sight. A fight wakes the room instead of one
      victim. This is what killed the "stab a pack apart one at a time" exploit.
    - **Bosses** are never fooled — the set-piece of every 5th floor is not something
      you tiptoe past. (CLAUDE.md nominated this lever at Phase 7; 0.9.6 took it.)
    - **Proximity** — within `SHADOW_NOTICE_RADIUS` (1) you are simply too close to
      hide. Note shadowcasting marks **every** depth-1 tile visible, corners included,
      so this really is unconditional at knife range; the corner protection that
      remains is `meleeReachable`, so a kitty-corner enemy aggroes and paths around
      rather than swinging through the wall.

    An already-chasing enemy that goes back out of range loses the trail through the
    normal de-aggro machinery — cover re-forms, it does not latch. Until 0.9.6 the only
    breaker was attacking that specific enemy, which made a player who declined to
    swing literally unkillable.

  - **Speed** — two steps per movement turn (see Turn Order for the exact rules).
  - **Survival** — one cheated death, restoring half the bar (see Death).

Enemies route around item tiles already, so hidden keys and locked chests bend their
paths slightly — harmless. Known accepted quirks: a key within reveal range of the
arrival stair glimmers on the first command after arrival, not on arrival itself;
Sight's `explored` fill lags one turn behind the unlock for click-pathing purposes
(the full-bright rendering is immediate).

## Visual Style

**Everything renders as SPD sprites — terrain, creatures, and items — with the
full ASCII look kept one switch away.**

Terrain (floors, walls, doors, stairs) draws from Shattered Pixel Dungeon's prison
tilesheet (`public/assets/environment/tiles_prison.png`, 16×16 frames, GPLv3 — see
`CREDITS.md` and the licensing note below) with SPD-style **autotiling**, ported as
pure functions in `src/renderer/autotile.js` and drawn by `spriteLayer.js` in two
image layers:

- **Ground layer** (under actors): floor variants (stable per-cell hash, salted by
  floor number), stairs, door faces, and raised-wall **front faces** (drawn on a wall
  cell whose south neighbor is open, with edge bits for open left/right).
- **Walls layer** (**over** actors): stitched wall **tops** (16 permutations keyed on
  left/right/below-diagonal openness), the **overhang** a wall casts into the non-wall
  cell above it, and door lintels. An actor standing directly below a wall is
  partially occluded by its top — **intentional SPD pseudo-3D, not a bug**. Overhang
  art keys its visibility off the wall cell below it, so remembered walls keep their
  caps. A wall cell's own art only renders when **anchored** — at least one of its 8
  neighbors is an explored non-wall cell (`wallCapAnchored` in `autotile.js`) — so
  lone wall cells marked explored by shadowcasting or the room-reveal ring never
  float as detached caps in unexplored blackness (room corner caps stay: the
  diagonal room floor anchors them). Doors render **open while an entity stands in
  them** (purely visual; the sim
  has a single door state). Doors come in two orientations: **raised** (walls
  east/west — front-on door face) and **sideways** (walls north/south — edge-on door
  in the wall run).

Creatures draw as **animated SPD sprites** (Phase 8) and items as static frames,
mapped in `src/renderer/entitySprites.js` (pure data, tested
against the shipped PNGs' headers): player = **warrior, tier-5 sheet row** (rows are
15px, row N = armor tier N) · goblin = **gnoll** · skeleton = **skeleton** · boss =
**evil Eye** (16×18 frames — taller than a tile, it floats up into the cell above) ·
potion = **crimson flask** · chest = **golden chest** · locked chest = **blue
crystal chest** (deliberately a different chest, so "locked" reads at a glance) ·
key = **golden key** (spawns `hidden`; unrendered until revealed) · rings = the SPD
gem-ring row (Sapphire = Sight · Onyx = Shadow · Topaz = Speed · Ruby = Survival,
via `RING_SPRITES`). Frames render centered
with feet **`SPRITE_LIFT` (5px) above the tile's bottom edge** — nearer the tile
center, so actors clear the south wall tops drawn over them and line up with
sideways doors — untinted; remembered items dim with the same grey multiply as
terrain. Sprites **mirror horizontally to face their last move or attack
direction** (right is the sheets' native default; vertical movement keeps the last
facing) via a renderer-local facing map fed by the turn's events
(`src/renderer/facing.js`).

**Animation (Phase 8)** — the old "no animation clock" policy is deliberately
reversed; the renderer remains strictly observation-only (no gameplay in any tween
or animation callback), but it now moves:

- **Idle/walk cycles** from the frames the SPD sheets always shipped: each entity
  spec carries `anims` (column indices along its row — walk 2–7 warrior, 2–6 gnoll,
  2–5 skeleton, the legless eye wobbles 0–2 faster when "walking");
  `registerSpriteFrames` creates the looping Phaser Animations, entities are Sprites
  playing idle from creation. **Idle is deliberately near-static** — humanoids run
  `[0, 0, 0, 1]` at 1fps (three seconds standing, one second with the head turned),
  matching SPD, where the hero measurably holds one frame for 1.5–2s at a time; an
  even two-frame flip reads as a permanent head shake. Each entity enters its cycle
  at its own phase (`idlePhase(id)`, golden-ratio spread off the entity id — no RNG
  draw, no `Math.random`) so a room of goblins never glances in unison. Walk cycles
  are brisk enough to read **across** a walk rather than within one step.
- **Move tweens** (`src/renderer/motion.js`): the pure half, `motionIntents()`,
  reduces a turn's events to per-entity glides (facing.js model, Node-tested;
  consecutive moves chain — a Ring-of-Speed turn is one two-tile slide) and the
  Phaser half glides the sprite over `TWEEN_MOVE_MS`. **`TWEEN_MOVE_MS ===
STEP_DELAY_MS` (110ms) is load-bearing**: a glide fills its step edge to edge, so
  consecutive steps run together as one continuous slide. A glide that ends early
  leaves the world frozen in the gap — that stall, not the speed, was the camera
  jitter in the Phase-8 build (80ms glide inside a ~100ms step, a dead stop ten
  times a second). It must not over-run the step either, or the sprite can never
  catch up. Turns arriving faster than a step (held-key walking at the ~30ms OS
  repeat rate) shorten their glide to match. Policy: **one tween per entity, latest
  wins**; a preempted glide **retargets from where the sprite is** rather than
  rewinding, so motion stays continuous across the seam, and endpoints always come
  from the entity's TILE, never from the live sprite position. Gliding sprites snap
  to whole world pixels each frame — Phaser's `roundPixels` floors the camera scroll
  to a world pixel, so an unsnapped sprite shimmers against it. `syncEntities` skips
  position writes for mid-glide sprites; gliders play their walk cycle and return to
  idle on arrival; floor changes clear everything, and a floor-change turn skips its
  glide entirely (`playEvents(events, { skipMotion })`) since the step onto the
  staircase belongs to sprites that no longer exist. **Attack lunges**: a 4px yoyo
  nudge toward the target per swing, tracked like a move so a sync can't stomp it.
- **The camera follows the player's sprite** (`startFollow`, lerp 1 — pinned dead
  center, not a lagging chase), with instant reframes on floor change/resize/first
  frame. It used to run its own pan tween alongside the sprite's; matching durations
  were not enough, because the two preempted differently and disagreed by a pixel.
  Following the sprite makes de-sync unrepresentable. **Clicks still unproject
  against the SETTLED camera center** (`camCenter`, the tile the player already
  occupies — `screenToTile` never reads the live camera matrix), so spam-clicking
  mid-glide can never mistarget. That unprojected pixel then goes through
  `pickClickTile`, which compensates for the wall art crowding corridors from
  above — see Canvas and Resolution.
- **Excluded, deliberately**: frame-based attack animations (the lunge sells the
  hit) and death animations (the sim deletes the entity and its sprite the same
  turn — a corpse-sprite pool is real new machinery; deferred).

Floating text stays text, and the whole cast falls back to **monospace ASCII
glyphs together** (never a mixed cast) if any sprite sheet fails to load: Player
`@` · `g` goblin, `s` skeleton, `B` boss · Potion `!` · Chest `$` · Locked chest
`&` · Key `*` · Ring `=`. `RENDER_STYLE`
in `src/renderer/tileStyle.js` is the internal art switch (`'sprites'` default;
`'ascii'` restores the full glyph game — Floor `.` · Wall `#` · Door `+` · `>`/`<`
stairs), with terrain likewise self-falling-back if the tilesheet is missing. The
fallback is a **silent safety net only** — since Phase 7 no UI surfaces glyph
notation (the Help legend is sprite-based). Visibility states
everywhere: **visible** (full color) · **explored** (dimmed — glyphs by scaled
tint, sprites by a uniform grey multiply; enemies are simply hidden when not in
view) · **unexplored** (black) — plus the Ring of Sight's full-floor reveal,
which renders everything fully lit through `query.isRevealed` without touching
the sim's visibility arrays.

## Licensing

The project is **GPL-3.0-or-later** (`LICENSE`, the verbatim FSF text; the copyright
notice lives in `CREDITS.md` and the README, never inside the license document). That
is forced, not chosen: the vendored tilesheet is from **Shattered Pixel Dungeon**
(Evan Debenham), based on **Pixel Dungeon** (Watabou), both **GPLv3** — there is no
permissive carve-out for SPD's art. Distributing this game with that art means
honoring GPLv3: keep the attribution in `CREDITS.md` (source repo, pinned commit,
sha256) and keep this repository's source public. Any future vendored art must get
the same treatment. `LICENSE` and `CREDITS.md` are copied into `dist/` by a small
plugin in `vite.config.js` — the obligation attaches to the **distribution**, so the
deployed site has to carry them, not just the repo. Production **source maps are
published deliberately** (the GPL already requires the source; public maps make a
live stack trace debuggable).

## Canvas and Resolution

Tile size fixed at 16×16. The viewport scales by showing **more tiles** on larger
screens, not larger tiles; the camera follows the player. **Integer scaling only**;
leftover space is neutral letterbox (no stretching). HUD elements anchor to screen
edges and adapt to any aspect ratio. Browser **pinch-zoom stays enabled** (WCAG
1.4.4 — never set `user-scalable=no`/`maximum-scale=1`). Gesture suppression is
scoped to the **game surface**: `touch-action: none` lives on `#game` and its
canvas, where it keeps play gestures from scrolling or double-tap-zooming
mid-game, and the overlay panels use `touch-action: manipulation` so they can
still be pinched and scrolled. Putting it on `html`/`body` — as the page did
until 0.9.4 — blocks zoom over the DOM overlays, which is exactly the text a
low-vision player needs to magnify; `tests/gesturePolicy.test.js` and the
campaign's E17 both reject that regression.

**Click alignment vs. the pseudo-3D art** (0.9.7). The screen→pixel half of the
math is exact and axis-symmetric: `screenToTile` unprojects against the settled
`camCenter`, which is the player tile's true center, and `followPlayer` cancels
`spriteOffset` so that center really is mid-screen. (`screenToTile` itself is no
longer symmetric end to end — it finishes through the deliberately one-directional
`pickClickTile` below.) The **art** is not symmetric either: a wall paints its
top over the **bottom half** of the open cell above it (`WALL_OVERHANG`, drawn in
the walls layer over actors), while the wall _above_ an open cell contributes
nothing into it. So a one-tile-wide **east–west corridor only shows its top 8px**
even though its hit box is the full 16 — the target reads a quarter-tile below
where the eye puts it, and the player sprite, feet `SPRITE_LIFT` above the tile
bottom, is drawn 4px up into the wall row, so clicking a character's head in a
corridor lands on solid wall. Rooms escape it because only a room's bottom-most
floor row carries an overhang; a one-wide corridor is _all_ bottom row. **Sideways
(east–west) doors** have the same shape and slightly worse.

The compensation is `pickClickTile` in `renderer/camera.js` (pure, Node-tested):
a click that already lands on a known-walkable tile is returned **untouched** —
which is why rooms, items and enemies in the open are unaffected — and only a
dead click gets a second chance, snapping down when it fell in the bottom
`CLICK_SNAP_PX` (half a tile) of a wall whose south neighbor is walkable. That
re-centers a corridor's hit box on the opening you can actually see. The fix is
deliberately in the **hit test, not the art**: shrinking the overhang would break
SPD's autotiling, and making the hit test perfectly faithful to the art would
shrink the corridor target to 8px rather than fix it.

`pickClickTile` runs a **second, earlier correction** (0.9.9) for the same class
of problem on the actor layer. `spriteOffset` lifts every character frame so its
feet clear the tile bottom, which draws **4px of a humanoid and 7px of the boss
into the cell above** — and in a room that cell is plain walkable floor, so the
click succeeded at the wrong thing: no entity there, attack intent quietly
downgraded to a walk, and clicking the boss's eye strolled you past it. The
sprite-lift pass therefore runs **before** the walkable early-return, the only
one of the three that fires on an otherwise-good click. It is scoped hard: the
click must fall in the bottom ≤7px of a cell **and** a currently-**visible**
entity must stand directly below, so walking onto the tile over an enemy still
works from the upper ~9px. The per-entity lift arrives through a `liftBelow`
callback the scene supplies (`GameScene.spriteLift`), keeping `camera.js` pure
and Node-testable and the sprite table out of the geometry.

## Language and Tooling

Plain JavaScript, ES modules throughout. No TypeScript. No barrel/`index.js` files
unless they solve a clear current problem. Only runtime deps are **Phaser** and
**Vite**; **Vitest** and **vite-plugin-pwa** are dev/build tooling, with
**ESLint** + **Prettier** as a correctness/format ratchet (`npm run lint`,
`npm run format`), **@vitest/coverage-v8** for coverage, and **jsdom** +
**playwright-core** for the UI and end-to-end tests. Prefer simple, readable code;
favor composition; keep systems loosely coupled; avoid circular dependencies.
Formatting is Prettier's (printWidth 100, single quotes) — run `npm run format`
before committing.

**One quality gate** (0.9.5): `npm run check` = lint + `format:check` + unit tests +
build + bundle budget; `npm run check:full` adds the browser campaign. Both CI
workflows call them, so a direct push to `main` faces the same gate as a PR (it
previously deployed having run only the unit tests). Lint is bare `eslint .` and
`format:check` shares `format`'s glob — the two used to disagree, leaving `e2e/`,
root configs, and every Markdown file unchecked. Coverage thresholds sit a few
points under the measured level (~87% lines/branches) as a floor, not a target;
only `main.js`, `phaserConfig.js`, and `GameScene.js` are excluded (they cannot run
outside a browser), so the ~40% coverage of the scene-taking renderer modules stays
visible rather than excluded away. `scripts/check-bundle.mjs` enforces gzip
entry-chunk and precache ceilings (currently 89% of both) — Vite's own chunk warning
is raised to 2000 kB because Phaser is expected to be large, which left nothing
watching the real number.

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
**0.5.0**; Phase 5, sprite terrain, was **0.6.0**; Phase 6, entity/item sprites, was
**0.7.0**; Phase 7, secrets, was **0.8.0**; Phase 8, animation, was **0.9.0**;
`package.json` is always the current number).

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
  renderer/   // ALL Phaser code only; autotile.js (pure sprite-frame logic) +
              // spriteLayer.js (sprite terrain) + glyphLayer.js (ASCII terrain) +
              // entitySprites.js (entity/item frame table)
  ui/         // HUD, message log, game-over, menu, leaderboard, help (DOM overlays);
              // overlay.js is the shared modal factory, dom.js small DOM helpers
  input/      // keyboard, mouse, touch
  net/        // leaderboard client — the only fetch/localStorage code; never
              // imported by the sim (architecture-test enforced)
public/
  assets/environment/  // vendored SPD tilesheet(s) — GPLv3, see CREDITS.md
  assets/sprites/      // vendored SPD creature/item sheets — same licensing
  icons/               // PWA icons, generated from the boss sprite
server/       // Cloudflare Worker + D1 leaderboard backend (deployed separately)
scripts/      // headless tools: balance simulator, dashboard-worker generator,
              // bundle budget, icon generator
tests/        // Vitest suites (node by default; jsdom per-file for ui/input)
e2e/          // browser campaign + its fixtures (see e2e/README.md)
docs/audits/  // dated, commit-pinned historical audit snapshots
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
boss 26 HP base, +12/tier, exempt from the flat damage drip. _(These are the 3d-era
values; 3f re-tuned them and 0.9.3 re-tuned again. The Combat section above — goblin
7 HP, skeleton 4 HP, boss 24 HP base, chest table 25/20/25/20/10 — is authoritative.
The 7/4 HP pair happens to be back where 3d put it: 3f cut it to 6/3, and 0.9.3
restored it to pay off the corner-fix's difficulty debt.)_

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

Phase 5 (complete): **sprite terrain** — the deferred Phase 2 (pixel art), revived
for terrain only. Vendored SPD prison tilesheet (GPLv3, `CREDITS.md`) · SPD-style
**autotiling** as pure unit-tested functions (`src/renderer/autotile.js`) ·
two-layer rendering with wall tops drawn **over** actors (`spriteLayer.js`) ·
per-cell floor/wall variants from a seed-stable hash · doors in both orientations
that render open while occupied · explicit depth-ordered scene layers (fixing a
latent rebuildFloor z-order bug) · ASCII fallback kept intact behind `RENDER_STYLE`
(and used automatically if the sheet fails to load). Entities/items stay ASCII —
see Visual Style. Enemy/item sprites, water/grass/decor, and the menu art-style
toggle are **explicitly deferred**, not in scope.

Phase 6 (complete): **entity and item sprites** — the rest of the cast joins the
terrain: vendored SPD warrior/gnoll/skeleton/tengu/items sheets ·
`src/renderer/entitySprites.js` frame table (first idle frame of each SPD sprite
class; player = warrior bottom row, boss = Tengu, potion = crimson flask, chest =
golden locked chest), tested against the shipped PNG headers · sub-tile frames
centered feet-on-tile · all-or-nothing glyph fallback (a missing sheet reverts the
whole cast, terrain independent) · Help flavor refreshed. _(Phase 6 shipped static
frames only; Phase 8 later reversed the no-animation-clock policy — see Visual
Style, which is authoritative.)_ Water/grass/decor and the menu art-style toggle
remain **explicitly deferred**.

Post-Phase-6 polish (**0.7.1**): sprite-mode playtest fixes — `SPRITE_LIFT` (feet
3px above the tile bottom) · wall-cap anchoring (no floating caps) · canvas CSS
size derived from the buffer (exact 1:1 device-pixel mapping at fractional dpr) ·
left/right sprite facing from move/attack events · player re-skinned to the tier-5
warrior row · boss re-skinned to SPD's evil Eye (tengu sheet retired). _(The Phase
5/6 notes above predate this and still say Tengu/tier-6/feet-on-bottom; the Visual
Style section is authoritative.)_ **0.7.4**: the PWA icon set (`public/icons/`) is
now the evil Eye itself — derived from the boss sprite's first frame by
`scripts/make-icons.js` (zero-dependency PNG decode → nearest-neighbor upscale →
re-encode; run it to regenerate) with a matching CREDITS.md "App icons" section,
since the icons are GPLv3-derived art rather than unmodified SPD files.

Phase 7 (complete): **secrets** — once per 5-floor band, a hidden proximity-revealed
key (earlier floor) and a locked crystal chest holding one of four passive rings
(later floor): Sight / Shadow / Speed / Survival — full spec in the Secrets section.
Seed-hash band plans (`world/secrets.js`), turn-engine reveal + unlock + speed-step
rules, per-enemy provoke, two lethal-site survival hook, sprite-first Help legend +
HUD chips via composition-root icon injection, balance-bot awareness (single-step
opt-out; shadow-aware threat filter), e2e fixtures regenerated. Balance snapshot
(200-run thorough bot): floor-10 clear 19% → 30% — floors 1–4 untouched, the
mid/late lift is the rings working; whether that was too generous was left as a
tuning question for a patch (candidate lever: the boss seeing through Shadow).
_(0.9.6 took that lever, and two more, overshooting slightly; 0.9.8 closed the
question by setting an accepted band — see below. The Secrets section is
authoritative for how Shadow and Survival behave now.)_

Phase 8 (complete): **animation** — the deliberate reversal of the
no-animation-clock policy, entirely inside the renderer (sim, input timing, and
e2e parity untouched): move tweens with a pure Node-tested intent reducer
(`renderer/motion.js`; latest-wins preemption, speed-ring moves chain into one
glide) · camera panning in lockstep with settled-center click unprojection ·
attack lunges · idle/walk cycles from the frames the vendored sheets always
shipped (no new assets, no licensing change). Full spec in Visual Style.
Frame-based attack/death animations and water/grass/decor stay deferred.

Post-Phase-8 playtest fixes (**0.9.1**, renderer only): the Phase-8 build's
movement visibly stuttered — measured off 60fps phone capture, each step
delivered its tile over five frames plus **one frame of dead stop**, because the
80ms glide sat inside a ~100ms step. A glide now spans its step exactly
(`TWEEN_MOVE_MS === STEP_DELAY_MS`, both 110ms, matching SPD's measured pace),
faster turns shorten their glide to match, preempted glides retarget instead of
rewinding, glide endpoints come from the entity's tile rather than the live
sprite, gliding sprites snap to whole world pixels (Phaser floors camera scroll
to a world pixel, so an unsnapped sprite shimmers against it), and the camera
**follows the player's sprite** instead of running a parallel pan that could
disagree with it. Idle cycles went SPD-calm and per-entity de-phased (a 500ms
head-flip loop read as a permanent head shake). Also: floor-change turns skip
their stale glide, lunges are tracked like moves, floating numbers drift half as
far, and `SpriteTileGrid.sync` memoizes per cell instead of rewriting all 6336
terrain Images every turn. **0.9.2**: melee reach obeys the corner rule for
enemies too (see Combat) — a correctness fix with a large balance consequence.
**0.9.3**: the re-tune for it. 0.9.2 flattened the whole survival curve, not just
its tail (thorough bot floor-10 clear 30% → 50%, floor-1 deaths 24% → 14% of runs),
so the fix's difficulty debt was paid back with **base enemy HP 6/3 → 7/4** — chosen
by sweeping every flat and depth-scaled lever through `npm run balance` and keeping
the one that best restored the 0.9.0 curve SHAPE, not merely its headline number.
Floor-10 clear is 34/36/30% on three independent 200-run seed blocks (mean 33%,
0.9.0 was 28%) and floor-1 deaths are back to ~18%, which is the Phase-3f target.
Skeleton kills stay below their 0.9.0 share: a half-speed enemy loses the most when
it has to walk around a corner it used to reach through, and that is the honest
residual of the fix rather than something to tune away.

**0.9.4 — audit remediation, waves 1–2** (from the 2026-07-27 engineering audit of
`194f4f0`, filed with every past audit under `docs/audits/` as a dated,
commit-pinned **historical snapshot** — never edited to match later code). Four
findings closed, all outside the balance envelope (the simulator is byte-identical):
**stair steps consume a turn** like any other move (they were free, and `state.turn`
is the leaderboard tie-break — see Turn Order) · the project is **licensed**
GPL-3.0-or-later with `LICENSE`/`CREDITS.md` shipped in `dist/` (see Licensing) ·
**pinch zoom restored** — `touch-action: none` moved off the page and onto the game
surface, so the DOM overlays can be magnified and scrolled (WCAG 1.4.4; a static
test now rejects a page-wide gesture block) · the **HUD and message log are built
from DOM nodes** instead of interpolated HTML strings, closing the last dynamic
markup sinks. Two standing decisions were recorded rather than deferred: the
leaderboard is an **honor system** and says so, and production **source maps stay
public**.

**0.9.5 — audit remediation, waves 3–5**, closing that audit. Balance is
byte-identical throughout (the acceptance test for the spawn refactor, not a
nice-to-have). **Leaderboard client**: failures classified so a permanent
rejection can't poison the offline queue, request timeouts, a single-flight
flush, a versioned queue. **Server**: CORS fails closed, bounded rate-limit
state with `Retry-After`, byte-accurate body limits, D1 errors normalized into
JSON, duplicate submissions refused, and the dashboard worker generated rather
than hand-inlined. **CI**: one `check`/`check:full` gate run by both workflows,
lint and format widened to the whole repo (which surfaced seven dead bindings in
`e2e/`), the browser campaign automated on PRs, plus coverage thresholds and a
bundle budget. **Sim**: one item-placement primitive, `ensureArrivalClear`
searching the full component and reporting failure, descriptive turn-order
comments, and the broad-seed invariant suite. Also: `randomSeed` no longer
assumes Web Crypto — a missing implementation used to throw at module scope and
stop the game booting; it falls back to the clock, never `Math.random`, which
would violate the seeded-RNG rule.

**0.9.6 — ring rebalance + End run.** Playtesting confirmed what the Phase-7 note
suspected, and named the ring: **Shadow** made a player who declined to swing
_unkillable_ — nobody ever tried — and let a room be picked apart one at a time while
the bystanders stayed oblivious. Three cover-breakers now exist (noise through walls,
boss immunity, knife-range proximity), collapsed into one exported predicate,
`query.hiddenFromEnemy`, that `ai.js` and the balance bot both read; **Survival**
restores half the bar instead of all of it. **Sight and Speed are deliberately
untouched.** Also: a **End run** menu action (two-step confirm) ends a run on purpose
into the normal score-submission screen — previously the only route to the leaderboard
was dying — via a new `'ended'` status. No new RNG draws anywhere, so a ringless run is
byte-identical and the e2e parity fixture needed no regeneration.

Balance (thorough bot, 200 runs/block, `--max-floor 12`), floor-10 clear rate:

| seed block | before | after |
| ---------- | ------ | ----- |
| 1000       | 34%    | 25%   |
| 3000       | 36%    | 28%   |

Boss share of deaths rose 23% → 30% (seed 1000) — the boss lever working, not a
regression. The **shape** is the point: floors 1–5 are unchanged run-for-run (reached
100/83/68/58/55 before and after) and the rusher bot is untouched (0% clear, median
death floor 2, both blocks), because rings do not exist that early and a reckless bot
rarely carries one. The drop is concentrated from floor 6 on, exactly where the exploit
lived. Two levers were swept and **rejected** as ineffective rather than shipped blind:
`SHADOW_NOISE_RADIUS` 5 → 3 moved clear rate by one point (most fights already happen
within 3 tiles, so the wider, more coherent radius is kept), and reverting Survival to a
full heal bought two. The remaining ~7 points are intrinsic to the boss and proximity
rules — i.e. to the fix itself. This landed the curve ~6 points under the ~33% the
project had calibrated to since 0.9.3, and 0.9.6 deliberately left open whether that
gap was too harsh. **0.9.8 closed it — see the difficulty target below.**

**0.9.7 — playtest polish.** Three fixes, no new mechanics. **The click path routes
around staircases**: a staircase between the player and a click used to end the floor
by accident, since a step onto one swaps the floor immediately. The planner now
prefers a stair-free route (clicked tile exempt) and, where a staircase is the only
way through, stops on the tile in front of it — see Movement and Pathfinding.
**Corridor clicks are aligned to the art**: the SPD wall overhang covers the bottom
half of the cell above it, so a one-wide east–west corridor shows only its top 8px
while its hit box is the full 16, putting the target a quarter-tile below where the
eye is aiming; a dead click in the lower half of a wall now snaps onto the walkable
tile below it (`pickClickTile`) — see Canvas and Resolution. **The boss chest no
longer stacks**: it relocated off a staircase already, and now off a tile that
already holds an item, which a boxed-in boss can die on.

Two playtest reports resolved as **not bugs**, with a regression test where one was
missing. "The first locked chest is always a Ring of Survival" — the pick is
uniform (`ringFor` is a correct Fisher–Yates over `RING_TYPES`; measured 25.1/25.0/
25.0/25.0% for band 0 over 200k seeds, and Survival is `RING_TYPES[3]`, the entry
the first swap moves _out_). What makes a small sample look rigged is that the
band-0 chest is on floor 5 in **52%** of runs, so few runs ever open one — and that
a browser **refresh replays the same run**, since `syncUrlSeed` keeps `?seed=` in the
URL, so reloading rather than using **New run** reproduces the identical ring every
time. That URL behavior is deliberate and unchanged. And "does boss loot drop onto
the player's tile and instantly vanish" — no: the drop lands on the boss's own death
tile, which two entities can never share.

Balance: the stair and click changes are **provably zero-impact** — the headless bots
have their own BFS and never call `planPath` or the renderer, and with only the boss
chest fix reverted the simulator output is byte-identical to 0.9.6. With it in, every
survival number still matches exactly (per-floor reached, deaths, floor-10 clear 25%,
median death floor 3, death causes, turns/run); only mean HP and armor on descent
move, and only on floors 10–12, which is the relocated chest being collected instead
of stranded.

**0.9.8 — the last two quirks, and a difficulty target.** Both quirks the Secrets
section had listed as accepted came from one root cause: the reveal and fill passes
are keyed to a **player command**, and arriving on a floor and unlocking a chest are
not commands. **A key beside the arrival stair now glimmers on arrival**, not on the
next command — `resolveStairStep` runs the reveal pass after the floor swap, where
`descend`/`ascend` have already computed FOV. **The Ring of Sight's `explored` fill
lands on the pickup turn**, not the next one — the ring is worn at turn step 5, after
step 3's FOV pass, so the floor lit up instantly (the renderer reads
`query.isRevealed`) while click pathing across it silently lagged a turn; a second
`updateVisibility` runs when the flag flips. Neither draws RNG.

**Difficulty target (supersedes the 0.9.6 open question).** Floor-10 clear rate for
the thorough bot is a **band, 25–33%**, not a single number. Measured across four
independent 200-run seed blocks at 0.9.8 — 1000/3000/5000/7000 → **25 / 28 / 26 /
28%** (mean 26.75%) — so 0.9.6's Shadow nerf is inside the band and **no enemy-stat
lever is being pulled**; the ~33% figure was one point in the band, not the target.
Worth knowing: the curve sits at the band's **lower edge**, with one block exactly on
25%, so any future change that makes the game harder should be measured against this
before shipping. If one ever pushes it below 25%, the 0.9.3 precedent still applies —
pay it back with a separate enemy-stat lever rather than by watering down the Shadow
rules.

Balance for the quirk fixes themselves: **byte-identical**. Both were expected to be
able to move it — `scripts/balance/policies.js` targets revealed keys and the Sight
fill feeds `isKnownWalkable`, so a bot could in principle route differently a turn
earlier — so it was measured rather than assumed, and the simulator output did not
move at all.

Also 0.9.8: **`pickClickTile` is gated on sprite mode.** The snap compensates for
the SPD wall overhang, and the ASCII fallback has no overhang — a `#` fills its own
cell — so applying it there turned a click on a plainly-visible wall into a move.
`screenToTile` now uses the plain `worldToTile` whenever `useSprites()` is false,
which is the same predicate `makeGrid` already branches on. Found by automated
review on the PR. A second review finding — that a click just above the map could
snap into row 0 — was **checked and rejected**: it needs a walkable border cell, and
the generator seals the rim (0 walkable border cells across 120 generated floors).
Rather than leave that as an unverified claim, the rim is now a tested invariant.

**0.9.8 audit remediation.** `docs/audits/2026-08-01-b7e66f7-v0.9.8.md` is the
first audit since v0.9.3 — 0.9.4 through 0.9.7 had never been independently
reviewed. **The simulation layer came through with no P0 and no P1**, every
candidate at that level refuted under adversarial checking (~275k randomized
commands over 550 seeds, 7,272 click-paths on 720 real floors, byte-level replay
determinism, FOV symmetry over 20k pairs). The defects were all in the layers
_around_ the sim, and shared one shape: a correct mechanism given a guard, index
or predicate slightly narrower than the thing it guards. Fixed in the same
release, balance byte-identical throughout:

- **`window.localStorage` read at module scope could stop the game booting** —
  the property _throws_ when site data is blocked, aborting the composition root
  into a blank page. The identical failure `randomSeed` was fixed for in 0.9.5,
  in the twin dependency. Now behind a probing `safeStorage()` shim.
- **Remembered doors repainted from unseen enemy positions** — the terrain
  layer's `isOpen` read live entity tiles with no visibility filter, so a
  doorway across the map swung open as an unseen goblin passed through it.
  Doors are opaque _precisely_ so a doorway's contents are unknowable; only the
  terrain layer leaked. Gated on the cell's own lighting.
- **The offline queue could lose a score submitted during a flush at cap** — the
  "arrived during the drain" set was computed by array index, and capping drops
  oldest-first, so the index landed past the end and the drain wrote an empty
  queue over a score already reported as saved. Tracked by identity now. The
  existing test covered the same race _below_ cap, where it passes either way.
- **`fetchScores` could hang forever** — the deadline was cleared once headers
  arrived, so a stalled body left the leaderboard overlay on "Loading…". The
  body read is inside the deadline now; `post()` never read a body, so the death
  screen was never exposed.
- **Four latent simulation couplings**, none reachable in shipped play: the boss
  chest's last-resort stacked on the tile it had just rejected (now a widening
  DIRS8 BFS, ring 1 identical); `resolveStairStep` ignored `ascend`'s refusal;
  a failed `planPath` left the old path installed; and the boxed-in `dropRing`
  wore the ring **silently** — that last one _is_ reachable, since the enemy
  phase runs before pickups and a chaser can seal a dead-end behind you.
- **Tooling**: the HTML-sink guard banned `${` splicing but not concatenation,
  which `menu.js` was already using; the e2e escaped-request tripwire gated in
  only 3 of 17 scenarios and page errors never failed the run; lines/statements
  coverage floors sat 13.8 points under measured. All tightened, and two
  genuinely **vacuous tests** repaired (a queue-migration case that never called
  the client, and a dashboard-parity case whose CORS dimension compared `null`
  to `null`).

0.9.8 deferred the precache finding and the four P3 items; **0.9.9 closed all
five** — see below.

**0.9.9 — everything the audit left open.** Nothing in the repo is now recorded
as unresolved except confirming the leaderboard worker is serving current code
(issue #30) — a verification, not a code change. The worker itself is no longer
deployed by hand: it builds from this repository, so `server/` ships with
everything else (see Leaderboard). The one step that stays manual is applying
`schema.sql`, and it has to happen BEFORE merging code that depends on it.

- **Vendored art now gets precache revisions.** An entry with `revision: null`
  is never re-fetched while its URL is unchanged — correct for a file whose
  NAME carries a content hash, wrong for anything else. vite-plugin-pwa defaults
  `dontCacheBustURLsMatching` to `/^assets/`, i.e. "everything under
  `dist/assets/` is hashed", which is false here: the SPD sheets live in
  `public/assets/` because Phaser loads them by runtime URL string, so Vite
  never hashes them. A re-vendored sheet could not have reached an installed
  PWA, and `tests/entitySprites.test.js` validates rects against the _repo_ PNG,
  so such a change would have passed CI while installed clients sampled the old
  art. Now matched on Vite's actual chunk shape,
  `^assets/name-[hash].js|css`. **The 0.9.8 deferral reason was wrong** and is
  worth recording as wrong: "whether installed clients recover cannot be
  answered from a repository" is true of _moving the files_, but adding a
  revision is self-repairing — the same URL with a revision reads as a changed
  entry, so the next service-worker update re-fetches once and every later
  change propagates. That is answerable from the generated manifest.
  `scripts/check-bundle.mjs` now **fails the build** if any unhashed URL ships
  revision-less, which also caught a first attempt whose regex was loose enough
  to swallow `apple-touch-icon.png`.
- **The death overlay joins the modal contract** the other three get from
  `ui/overlay.js`: `role="dialog"`, `aria-modal`, `aria-label`, `tabIndex=-1`,
  focus restored on close, and the panel itself focused when the initials form
  is hidden — without which nothing inside the dialog held focus and the Tab
  trap never fired at all. It still does not go _through_ `createOverlay`: no
  close button, its own Enter/Space restart, a form.
- **Clicking a character targets the character.** `spriteOffset` lifts frames so
  their feet clear the tile bottom, which draws 4px of a humanoid (7px of the
  boss) into the cell _above_ — and in a room that cell is walkable, so
  `pickClickTile` returned it untouched and "attack the boss" silently became
  "walk past the boss". A third pass, ordered **first** because it is the only
  one that fires on an already-walkable click, snaps down when a **visible**
  entity below pokes into the clicked band. The per-entity lift comes from a
  `liftBelow` seam the scene supplies, so `camera.js` stays pure and the sprite
  table stays out of it.
- **`trapTabKey` respects the `hidden` attribute**, not just inline
  `display:none` — `menu.js` sets `endBtn.hidden` on the death screen, which
  left a non-focusable element in the Tab cycle.
- **The rate-limiter bound is tested**, not just implemented: the 0.9.5
  "bounded map" headline had zero coverage and the 0.9.8 audit had to verify it
  by hand. Both branches are now driven through the real fetch handler.
- A comment in `motion.js` claiming the lunge guard is "never true today" was
  simply wrong — it fires whenever turns arrive faster than `TWEEN_MOVE_MS`.

`window.__game` remains exposed **deliberately**: it is a debugging and
reproducibility affordance, and hiding it would not be anti-cheat — the POST
endpoint is spoofable regardless, which is exactly why the board is an
acknowledged honor system.

**0.9.10 — a dropped item is never invisible; the honor footer is gone.** Two
unrelated playtest items.

**Rings and boss chests keep out of doorways.** A ring tumbling from a locked
chest could land on a **door** tile and simply not be there: the drop scan
accepted any walkable-ish tile, and the sprite renderer paints a **sideways**
door (`autotile.js`'s `wallsFrame`) as a full frame in the **walls layer**,
which is drawn OVER the item layer by design. Nothing rescued it, either — the
"door renders open while occupied" rule builds its occupancy set from
**entities only**, so an item never opens the door it is hiding under. The
pickup worked the whole time; only the art lied. The same predicate backed the
boss chest, so a boss dying in a doorway hid its reward the same way. Fixed in
the **sim**, not the renderer — the walls-over-actors occlusion is the SPD
pseudo-3D the project wants, and spawning has always been floor-only
(`randomFreeFloorInRoom`: "nothing spawns in a doorway or on `>`"); the two drop
paths were the only code that disagreed. Both now share one predicate,
**`query.canDropAt`** — unoccupied, item-free, `TILE.FLOOR` — which folds in the
stairs exclusion 0.9.7 added for the same class of reason (a staircase swallows
the pickup, a doorway hides it). The boss chest's widening BFS still queues
_through_ doors, so a boss that dies in one relocates to the nearest real floor
tile rather than giving up. "No item on a door tile" joins the broad-seed
invariants next to "no item on a staircase". Balance: byte-identical (the bots
fight bosses in rooms, and a chest-adjacent doorway is rare enough not to appear
in 400 runs) — measured rather than assumed, since a moved chest is exactly the
kind of thing that shifts a run.

**The leaderboard's honor-system footer is removed.** The board is still an
honor system and both READMEs still say so; the overlay just no longer repeats
it under every table. See the Leaderboard section.

**0.9.11 — Codex audit remediation (v0.9.10, `5255dc1`).** Every one of the
audit's 14 findings was verified true, but the ranking was inverted: neither of
its two P1s could produce a wrong pixel, a wrong turn or a lost score, while the
one finding with real data loss sat below both. Balance is **byte-identical**
(the acceptance test for the one simulation change, not a nice-to-have). Taken:

- **The offline queue actually retries.** `flushQueue` ran on boot and on
  `online` and nowhere else, so a retryable failure while the tab stayed
  online — a 500, a D1 outage, a timeout — queued the score and then nothing
  ever came back for it, while the death screen said "will send later". There
  is now a backoff ladder (10s doubling to a 5-minute cap, reset on success)
  on injected timer functions, plus a `visibilitychange` flush and a `pagehide`
  teardown. **No jitter, deliberately** — it decorrelates a fleet, this is one
  tab, and it would mean `Math.random()` under `src/`, which the architecture
  test forbids outright. Three defects the audit missed, all in the same code:
  the backoff was armed by **any** non-ok status including permanent 4xx that
  are never retried; it **assigned** rather than extended, so a later short
  `Retry-After` undid a longer one; and `submit()` ignored it entirely and
  POSTed straight through an active backoff (it now queues — safe only because
  the timer exists).
- **`fetchScores` validates the response shape.** It returned
  `res.data.scores || []` and the view calls `.forEach` on it. The audit's
  mechanism was partly wrong and the fix is written to the real one: a `null`
  body throws _inside_ the try and is swallowed as `reason: 'network'` — a
  mislabel, not a crash — and only a **truthy non-array** `scores` actually
  escaped. Also missed by the audit: `formatAge` had no finite check, so a
  non-finite server clock rendered **"NaNd ago"**. The device-clock fallback for
  a missing `now` is gone on purpose (see the Leaderboard section).
- **A rejecting request body is a 400, not a crash.** `await request.text()` sat
  outside every try/catch and the handler has no outer one, so an aborted or
  truncated upload escaped as an opaque platform 500 **with no CORS headers** —
  which the client can only read as a network error. Exactly what `storageError`
  exists to prevent, one step earlier in the request.
- **`GET /health`** — closes issue #30, the repo's one recorded open item.
  Returns the deployment id and timestamp (Cloudflare's `[version_metadata]`
  binding, so it cannot drift the way a hand-kept version string does), a real
  D1 probe, and the **row count** — the only field that tells the right database
  from a schema-compatible wrong one. Deliberately NOT the audit's schema-version
  table and migration machinery. The old "POST twice, look for 201 then 409"
  probe still works but is inferential and leaves a junk score.
- **Secret placement no longer gives up silently.** `spawnSecrets` skipped the
  band's key or locked chest when its ten random room scans all missed. A missed
  key was survivable (keys are interchangeable); a missed **locked chest cost the
  run that band's ring**, and `secretPlan` never re-rolls the chest floor. A
  deterministic room-then-tile sweep over `query.canDropAt` now catches what the
  random path misses, drawing **zero RNG** — same shape as 0.9.8's boss-chest
  BFS, and what keeps every existing seed identical. The `rooms.length < 2` bail
  the audit missed now warns rather than vanishing. Tested against the pure
  function directly: random and the sweep search the same tiles by the same
  predicate and differ only in thoroughness, so no constructible floor makes one
  provably fail and the other provably succeed without rigging the generator —
  pinning the helper is the honest version, and beats a vacuous integration test.
- **A version-consistency gate.** `package-lock.json` said `0.9.5` in both root
  locations while `package.json` said `0.9.10` — five releases of drift against
  the briefing's own single-source-of-truth rule, because nothing read it.
  `scripts/check-version.mjs` runs first in `npm run check`.
- **Docs caught up with Phase 6.** README called Help a glyph legend and ASCII
  "one switch away"; `tileStyle.js` still claimed entities and items stay ASCII
  either way, which `GameScene.useEntitySprites()` falsified. Help gained a
  **Rules** table for what a player could otherwise only learn by being surprised
  (stair-avoiding auto-walk, one swing per enemy click, numpad-only diagonals and
  the corner rule, Speed's forfeits, Shadow's noise through walls, End run, the
  d20 and the minimum-1 damage floor), and "Numpad 1–9" became "1–4, 6–9" —
  numpad 5 is unmapped.

**Rejected, with reasons, so they are not re-filed.** The audit's suggestion to
change `grep` to `rg` in `server/README.md` is **wrong**: that snippet is a
command a human operator runs on their own machine, where `grep` is universal and
`rg` is not, and the ripgrep preference is agent-tooling guidance rather than a
project convention. A **wait command** (numpad 5) is a new mechanic and the scope
fence below forbids it — only the documentation half was taken. **Idempotency
keys** for the duplicate-submission race are over-built for a board the audit
itself says not to harden: the consequence is one extra row when two tabs race,
and it stays an accepted quirk. The **bundle-headroom** item recommended no
action. Deferred, not rejected: D1 retention (the 30-day window still filters
reads without deleting rows), dependency-update automation, `prefers-reduced-
motion`, and an e2e Chromium preflight.

**0.9.12 — an HP bar in the HUD.** The HP readout gains a fixed-width bar beside
its numbers: the bar carries the ratio at a glance, the existing `14/20` text keeps
the absolute values. Presentation only — no simulation change, no new RNG draw, no
balance run needed (nothing under `core/`, `world/`, `entities/`, `systems/` is
touched). It is inside the scope fence below for that reason: it re-presents state
the HUD already displayed, rather than changing what a player can do.

**Why the bar does not grow with max HP**, which is the non-obvious part and the
thing not to "fix" later: `maxHp` has **no cap anywhere** — the only write is
`player.maxHp += amount` in `openChest`, +4 per health chest — so it climbs
linearly at ~+1.27/floor (~39 by floor 12, ~52 by floor 20, ~67 by floor 30, and
nothing stops it). There is no width to size a growing bar against, and one that
resized mid-run would reflow the whole HUD every time a chest opened. A fixed track
with a proportional fill sidesteps both, and the numbers next to it supply the
absolute scale the ratio drops.

Worth knowing when reading the bar: because health chests **refill to full**, the
hp/maxHp ratio _rises_ with depth (0.80 on floor 1 → 0.90 by floor 30), so a deep
run's bar sits visually fuller than a shallow one. That is a property of the loot
table, not of the widget. The fill color reuses the HP number's own band
computation (`> 0.5` good, `> 0.25` warn, else bad) rather than recomputing it, so
the two can never disagree, and the bar is `aria-hidden` because it duplicates text
that is already accessible. There is deliberately **no transition**: the DOM
overlay layer swaps instantly everywhere else, `hud.js` recreates its children each
turn via `replaceChildren` (so a transition could not animate without restructuring
the chip to be persistent), and the renderer's floating damage number already sells
the hit.

**Do not** implement inventory, equipment, leveling, save files, quests, or any
mechanic not listed here. (The Phase-7 rings and keys are deliberately **passive,
auto-worn pickups** — flat flags on the player, no slots, no managing — not a
managed inventory/equipment system, which stays out of scope.)

## Testing

Each major module has browser-free unit tests (Vitest, default `node` env). The
simulation is kept independent enough that dungeon generation, combat, pathfinding,
and FOV are tested without instantiating Phaser. Determinism is guarded by
`tests/architecture.test.js`: no `Math.random()` anywhere under `src/`, no Phaser
outside `renderer/`, `fetch`/`localStorage` only in `net/` + the composition root,
and the renderer may import only read-only core (`constants`/`query`/`events`) and
its own modules — the guards match static, dynamic, and `require` import forms.
The same file also guards the **DOM trust boundary**: the state-driven overlays
(`hud.js`, `messageLog.js`) may not touch `innerHTML`/`outerHTML`/
`insertAdjacentHTML` at all, and no `ui/` module (nor the composition root) may
interpolate a value into an HTML sink — static markup shells with no data in them
are fine. `tests/gesturePolicy.test.js` parses `index.html`'s stylesheet and
rejects a page-wide gesture block (read declarations via `getPropertyValue`:
jsdom keeps `touch-action` but exposes no camelCase accessor, so `style.touchAction`
is `undefined` and the naive assertion passes vacuously). The
**UI and input layers** are tested with the DOM factories under **jsdom** (opt-in
per file via a `// @vitest-environment jsdom` docblock — `tests/ui-*.test.js`,
`tests/input.test.js`), exercising them through their injected-dependency seams,
including hostile-string cases proving state and log text render as text. The
leaderboard worker is plain `fetch(request, env)` JS, tested in Node with a fake D1
(`tests/leaderboard-server.test.js`, which also guards the hand-inlined
`worker.dashboard.js` copy against drift); the client tests inject fake
fetch/storage (`tests/leaderboard.test.js`). The sprite autotiler is pure and
covered by a decision-table suite (`tests/autotile.test.js`: corners, T-junctions,
stubs, both door orientations, map borders, variance distribution). The entity/item
frame table is verified against the vendored sheets themselves
(`tests/entitySprites.test.js` reads each PNG's IHDR and asserts every frame rect
lies inside its sheet — a bad rect or swapped asset fails in CI; the same file
guards the ring frames and the DOM-icon sheet dimensions in `renderer/uiIcons.js`).
The secrets feature has four dedicated suites: `tests/secrets.test.js` (band-plan
purity/determinism + real-run spawn cadence), `tests/lockedChest.test.js`
(locked/unlock/ring-drop flow), `tests/keyReveal.test.js` (proximity + FOV gating),
and `tests/rings.test.js` (all four ring effects, including the Ring of Speed's
turn-engine invariants and both Survival lethal sites), plus ring-speed auto-walk
cases in `tests/autowalk.test.js`. Since 0.9.6 the rings suite also covers each of
Shadow's three cover-breakers — noise (including that a **miss is exactly as loud as a
hit**, that the radius boundary is inclusive, and that noise passes a closed door while
sight does not), boss immunity, and the proximity break — with a decision table over
`hiddenFromEnemy` itself; the half-heal is pinned in both `rings` (end-to-end, derived
from `SURVIVAL_HEAL_FRACTION` rather than a literal) and `combat` (`tryRingSurvival`
directly, including the `max(1, …)` floor at `maxHp: 1`). `tests/ai.test.js` guards the
gate at the AI level and that a ringless run's aggro is unchanged; `tests/turnEngine.js`
covers `endRun` (freezes the world, consumes no turn, idempotent, never overwrites a
death, cleared by `restart`); `tests/ui-menu.test.js` covers the two-step confirm and
its disarm paths, and `tests/ui-gameOver.test.js` the death/ended wording.
The animation layer's pure half is covered by
`tests/motion.test.js` (intent reduction, move chaining, the
`TWEEN_MOVE_MS === STEP_DELAY_MS` contract and the fast-turn glide clamp,
`idlePhase` spread, and the "idle is mostly still" shape of the cycles), and the
animation-cycle frame rects by the entitySprites suite.

0.9.7 adds `tests/camera.test.js` — tile↔pixel round-trips plus a decision table
over `pickClickTile`: an already-walkable click is untouched, the bottom half of
the wall above a corridor snaps down, the **top** half of that same wall does not,
a wall with a wall below never snaps, and the snap is downward-only (the wall
_below_ a room never reaches up into it). `tests/autowalk.test.js` gains the
staircase cases — a detour that contains no staircase node and ends on the clicked
tile with the floor unchanged, a click on the staircase itself still descending,
an off-route staircase leaving the path byte-identical to the stair-free map's,
the chokepoint stopping one tile short, a click refused outright when the very
next step is the staircase, a keyboard step still descending, and an enemy
standing on a staircase still being pursued and swung at without descending.
`tests/boss.test.js` covers the drop relocating off a littered tile and the scan
skipping littered tiles as well as occupied ones. `tests/secrets.test.js` pins the
band-0 ring split near 25% each over 20k LCG-generated seeds — deterministic
input, loose bounds, so it catches a collapsed shuffle rather than flaking.

0.9.8 adds the two quirk fixes' regression cases, both mutation-checked (each
fails with its fix reverted, and its control case passes either way):
`tests/keyReveal.test.js` descends onto a **pre-cached** floor 2 — cached rather
than generated, so the arrival geometry is exact — and asserts a key within
`KEY_REVEAL_RADIUS` of the up-stairs glimmers on the arrival turn itself, that one
tile further stays hidden, and that it still announces only once;
`tests/rings.test.js` clears `explored`, puts a closed door between the player and
the far end so it is genuinely unseen, and asserts that the turn which picks up the
Ring of Sight leaves that end both `isKnownWalkable` and `planPath`-able. The
sealed-rim invariant in `tests/invariants.test.js` is load-bearing for
`pickClickTile`: an out-of-bounds click just above the map floors to row −1, which
its predicate cannot tell from a wall, so the snap could only reach in from outside
if row 0 were walkable. The generator never makes it so, and that test is what keeps
it true.

0.9.9 extends `tests/camera.test.js` with the sprite-lift pass (a head-band click
over a visible entity targets it; the same click with no entity, an unseen one, or
no `liftBelow` at all is untouched; the boss's 7px reach does not become 8; the
0.9.7 wall cases are unchanged), and `tests/leaderboard-server.test.js` with the
rate limiter's two bounds — the window reopening after its stamps go stale, and an
early IP getting a fresh allowance because it was **evicted** rather than retained
past the cap. Both are mutation-checked. The precache-revision rule is asserted at
BUILD time instead of in a unit test: `scripts/check-bundle.mjs` parses the
generated `dist/sw.js` and fails when any URL without a content hash carries
`revision: null`, which is the only place the property is actually observable.

**Broad-seed invariants** (`tests/invariants.test.js`, 0.9.5) assert the rules the
example-based suites' outcomes are supposed to obey, across 40 seeds and down to
floor 12: no two entities or two items on a tile, nothing in a wall or out of
bounds, no item on a staircase, revisited floors restored exactly, a squatter
always cleared off an arrival stair, one turn per successful command and none per
refusal, no state/RNG movement on a refusal, and same-seed determinism asserted
directly. Loose performance ceilings (generation, crowded floor-12 turns) catch an
order-of-magnitude regression, not runner noise. Two of these were mutation-checked
into usefulness: one read a non-existent `rng.state` field and passed vacuously, and
the transition sweep never naturally met an occupied arrival stair, so it now plants
one.

A **browser end-to-end** campaign lives in `e2e/` (Playwright via
`playwright-core`) and runs in PR CI (Chromium installed with playwright-core's own
CLI, cached by version; artifacts uploaded on failure):
`npm run build && npm run test:e2e` drives the real PWA through
17 scenarios — rendering, input→sim→renderer round-trips, floor persistence, overlay
layering, the death/leaderboard flow, PWA offline boot, the mobile **gesture
policy** (E17: computed `touch-action` and panel scrolling with Help open at
390×844@2x), and a recorded-command
**sim/browser parity** replay that deep-equals the headless engine (the fixture —
and so the replay's length — is regenerated by `node e2e/discover.mjs` after any
generation-affecting change, including one that shifts turn numbering). It spawns its
own preview server, stubs the production leaderboard (asserting zero requests
escape), and is **not** part of `npm test` (needs a browser + build) — `npm run
check:full` is what runs it locally. The Chromium binary comes from Playwright's
registry, with `CHROMIUM_PATH` overriding. See `e2e/README.md`.

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

{\rtf1\ansi\ansicpg1252\cocoartf2870
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 # CLAUDE.md \'97 Roguelike Project Briefing\
\
This file is automatically read by Claude Code at the start of every session. \
It contains the architecture rules, conventions, and scope for this project.\
Update it as the project evolves. It is the single source of truth.\
\
## Architecture: Simulation and Renderer Separation\
\
The game consists of two completely independent layers:\
\
**Simulation Layer** \'97 The game logic and state. Owns all game data: player position, \
enemy HP, dungeon layout, item locations, turn order, combat resolution. The simulation \
never imports or calls Phaser APIs. It exposes pure functions like movePlayer(direction), \
resolveAttack(attackerId, targetId), and advanceTurn(). The simulation can be tested \
without rendering anything.\
\
**Renderer Layer** \'97 All Phaser code and visual output. Observes the simulation state \
and draws it on screen. When the simulation updates, the renderer responds by updating \
sprites, text, or colors. The renderer must never modify simulation state directly. \
Rendering changes never trigger gameplay logic.\
\
This separation makes it trivial to test game logic without a browser, and makes it \
possible to swap visual styles (colored rectangles \uc0\u8596  pixel art sprites) without \
touching game rules.\
\
## State Ownership\
\
There is a single game state object owned by the simulation. This object is the \
authoritative source for all game data: player stats and position, all enemy data, \
dungeon layout, fog of war, items, and anything else that affects gameplay. All \
systems (combat, pathfinding, AI, dungeon generation) read from and write to this \
one state object. No system maintains its own separate copy of game data. This \
prevents synchronization bugs and makes debugging straightforward \'97 there is only \
one place to look.\
\
## Coordinate Conventions\
\
The simulation uses integer tile coordinates exclusively. The game world is a grid \
of discrete tiles, each identified by (x, y) integer pairs. Game logic never uses \
pixel coordinates. The renderer converts tile coordinates to pixel coordinates when \
drawing \'97 for example, tile (4, 7) renders at pixel position (64, 112) on a 16\'d716 \
tile grid. The simulation is unaware of this conversion and never performs it.\
\
## Randomness and Seeding\
\
All procedural generation and combat randomness must use a single seedable RNG \
(random number generator) abstraction, never Math.random() directly. Initialize the \
RNG with a random seed at startup and log the seed to the console. This makes dungeon \
generation and combat results deterministic and reproducible \'97 if a bug occurs on a \
specific run, you can re-run with the same seed to reproduce it exactly.\
\
## Turn Order\
\
Every game turn follows this sequence, strictly in order:\
\
1. Receive and validate player input (keyboard, mouse click, or touch tap)\
2. Execute player movement or attack\
3. For each enemy in deterministic order (ascending entity ID): move toward player, then attack if adjacent\
4. Resolve any item pickups (player walking over items)\
5. Update field of view and visibility\
6. Update HUD and message log\
7. Wait for next player input\
\
This sequence is the game's heartbeat. Strict ordering ensures fair, predictable gameplay.\
\
## Movement and Pathfinding\
\
8-directional movement is allowed \'97 players can move diagonally.\
\
**Primary input: Click or tap.** Clicking or tapping any tile on the map computes an \
A* path to that destination using only tiles currently known to be walkable. Unknown \
tiles are treated as blocked until explored. The computed path is stored and executed \
one tile per turn. The path cancels automatically if an enemy enters line of sight, \
the player takes damage, the path becomes invalid, or the player issues a new movement \
command.\
\
**Secondary input: Keyboard.** Arrow keys and WASD move exactly one tile per keypress, \
including diagonals.\
\
Both inputs are equivalent \'97 a mouse click and a finger tap are the same action.\
\
## Field of View\
\
Use symmetric shadowcasting for line of sight. Visibility is blocked by walls but not \
by open doors. Each turn, recompute which tiles are currently visible to the player.\
\
Tile visibility states:\
- **Currently visible:** Fully lit. Player can see and interact with these tiles now.\
- **Previously seen:** Darkened. Player remembers these tiles but cannot see them now.\
- **Unexplored:** Black. Player has never seen these tiles.\
\
Upon first entering a room, mark the entire room as explored so the player sees the \
full room layout immediately.\
\
## Combat\
\
When the player moves adjacent to an enemy, the attack happens immediately in that \
same turn. The player does not need a separate turn to attack.\
\
On the enemy's turn, if it is adjacent to the player, it attacks. If it is not \
adjacent, it moves toward the player.\
\
Each attack has a base hit chance of 75%. Display a floating "Miss!" when an attack \
fails and a floating damage number when it lands.\
\
Multiple entities cannot occupy the same tile.\
\
## Visual Style\
\
Render the entire game in ASCII text. Use a monospace font.\
\
- Floor: . (period)\
- Walls: # (hash)\
- Player: @ (at symbol)\
- Enemies: single letter (g for goblin, s for skeleton, etc.)\
- Health potions: ! (exclamation)\
- Stairs: > (greater than)\
- Doors: + (plus)\
- Unexplored tiles: (space)\
- Explored but not visible tiles: same character but in a darker color or dimmed\
\
This is the intentional art style for Phase 1, not a placeholder. The renderer should \
be structured so sprites could swap in later without touching game logic, but that is \
not a current priority.\
\
## Language and Tooling\
\
Use plain JavaScript only. Do not use TypeScript or any additional gameplay frameworks \
beyond Phaser.js and Vite unless explicitly requested.\
\
Use ES modules throughout (import/export). Avoid barrel files (index.js) unless they \
solve a clear, current problem.\
\
Prefer simple, readable code over elaborate abstractions. Introduce complexity only \
where it solves a current problem, not in anticipation of future ones.\
\
Write code as though this will become a large project. Favor composition over inheritance. \
Keep systems loosely coupled. Avoid circular dependencies.\
\
## Project Structure\
\
src/\
core/        // turn engine, game loop, rules\
world/       // dungeon generation\
entities/    // player, enemies, items\
systems/     // combat, pathfinding, fog of war\
renderer/    // all Phaser code only\
ui/          // HUD, message log\
input/       // keyboard, mouse, touch input handling\
assets/        // empty for now\
CLAUDE.md      // this file\
\
The simulation layer lives in core/, world/, entities/, and systems/. The renderer \
layer lives in renderer/ and ui/. Input handling bridges both \'97 it translates user \
actions into simulation function calls. No other files should import from renderer/ \
except the main entry point.\
\
## Phase 1 Scope\
\
Phase 1 is the complete core game loop. Build exactly this, then stop. Do not \
implement inventory, equipment, leveling, save files, quests, or any mechanic not \
listed below.\
\
**Phase 1 includes:**\
- Procedural dungeon generation with random rooms connected by corridors\
- ASCII text rendering\
- Player movement via click/tap pathfinding and keyboard (arrow keys/WASD)\
- Two enemy types with different HP and damage values\
- Combat system with 75% base hit chance and floating damage numbers\
- Health potions on the floor that restore HP when walked over\
- Stairs that generate a completely new dungeon floor\
- HUD displaying current HP, floor number, and scrolling message log\
- Field of view using symmetric shadowcasting with explored tile memory\
- PWA configuration for offline play and mobile installation\
\
Phase 1 is complete and playable when all of the above work correctly. Only after \
Phase 1 is solid should you move to Phase 2 (animations) or Phase 3 (additional content).\
\
## Randomness and Seeding\
\
All procedural generation and combat randomness must use a single seedable RNG \
(random number generator) abstraction. Never use Math.random() directly.\
\
Initialize the RNG with a random seed at startup and log the seed to the browser \
console. Keep the seed accessible (stored on game state or as a module variable) so \
deterministic runs can be reproduced later.\
\
All dungeon generation, enemy spawning, loot placement, and combat hit/miss resolution \
must use this same RNG. This makes the entire game deterministic \'97 given the same seed, \
the same dungeon and events will occur every time. If a bug is reported, ask for the \
seed and reproduce it exactly.\
\
## Testing\
\
Each major module should include basic unit-testable logic where practical. Keep the \
simulation independent enough that dungeon generation, combat, pathfinding, and fog of \
war can be tested without instantiating Phaser or rendering anything.\
\
Write tests like: "Generate a dungeon with seed X and verify it has rooms, corridors, \
at least one enemy, at least one potion, and stairs." Or: "Given two entities with \
specific stats, does combat resolve damage correctly?" These tests run without a \
browser and catch logic bugs quickly.\
\
Testing the renderer (Phaser drawing code) is Phase 2 work and uses Playwright.\
\
## PWA (Progressive Web App)\
\
The game must be installable as a PWA on mobile devices and work offline.\
\
**manifest.json:** Configure for fullscreen display with no orientation lock. The app \
should work in both portrait and landscape modes.\
\
**Service Worker:** Cache all game assets and code so the game runs completely offline \
after the first load. Players can add the game to their home screen and launch it like \
a native app.\
\
## Canvas and Resolution\
\
Tile size: 16\'d716 pixels (fixed).\
\
The visible viewport scales with screen size \'97 larger screens show more tiles, not \
larger tiles. The camera follows the player and the dungeon is larger than the viewport.\
\
Use integer scaling only to keep the tile grid clean and aligned. If the screen size \
requires a fractional scale (like 1.7x), use the nearest integer scale (2x) and add \
black letterboxing for any remaining space rather than stretching.\
\
HUD elements anchor to screen edges and adapt to any aspect ratio (portrait, landscape, \
wide desktop).\
\
## Maintaining CLAUDE.md\
\
This file is the single source of truth for the project. Claude Code automatically \
reads it at the start of every session.\
\
As the project evolves \'97 when you add new features, change architecture, or clarify \
rules \'97 update CLAUDE.md to reflect those changes. This ensures every future Claude \
Code session starts with current, accurate project knowledge without re-explaining \
decisions or rules.\
\
Keep CLAUDE.md concise and clear. It should be readable in one sitting.}
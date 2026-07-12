// Composition root. This is the ONLY module allowed to import the renderer
// layer. It wires the simulation, renderer, input, and UI overlays together,
// but never contains gameplay rules itself.
import { createGame, restart } from './core/gameState.js';
import { coerceSeed } from './core/rng.js';
import { EV } from './core/events.js';
import { createPhaserGame } from './renderer/phaserConfig.js';
import { createController } from './input/controller.js';
import { attachKeyboard } from './input/keyboard.js';
import { attachPointer } from './input/pointer.js';
import { createHud } from './ui/hud.js';
import { createMessageLog } from './ui/messageLog.js';
import { createGameOver } from './ui/gameOver.js';
import { createMenu } from './ui/menu.js';

function randomSeed() {
  const buf = new Uint32Array(1);
  (window.crypto || window.msCrypto).getRandomValues(buf);
  return buf[0];
}

// Prefer an explicit ?seed= in the URL (to reproduce a run), else a fresh seed.
// A numeric URL seed is coerced to a Number so it reproduces the run it was
// copied from (see coerceSeed); custom text seeds are used verbatim.
function chooseSeed() {
  const fromUrl = new URLSearchParams(window.location.search).get('seed');
  if (fromUrl !== null && fromUrl.trim() !== '') return coerceSeed(fromUrl);
  return randomSeed();
}

function logSeed(state) {
  console.log(
    `[dungeons] seed = ${state.seed} (base36: ${state.seed.toString(36)}) — ` +
      `replay with ?seed=${state.seed}`,
  );
}

// Reflect the active seed in the URL (without reloading) so a refresh replays
// the current run and the ?seed= link stays coherent with in-app seed changes.
function syncUrlSeed(seed) {
  const url = new URL(window.location.href);
  url.searchParams.set('seed', String(seed));
  window.history.replaceState(null, '', url);
}

const state = createGame(chooseSeed());
logSeed(state);
syncUrlSeed(state.seed);
window.__game = state; // exposed for debugging / reproducibility

const parent = document.getElementById('game');
const game = createPhaserGame(parent, state);

const hud = createHud(document.body);
const messageLog = createMessageLog(document.body);
// The menu (created below) layers over the death screen; while it is open, its
// seed form/input owns Enter/Space, so the death screen's restart shortcut stands down.
const gameOver = createGameOver(document.body, { isKeyboardBlocked: () => menu.isOpen() });

function refreshUi() {
  hud.update(state);
  messageLog.update(state);
}

// Start a fresh run on floor 1 with the given seed (number or string), resetting
// the run in place and refreshing every overlay + the visuals. Shared by the
// death screen (new seed) and the menu (new / same / entered seed).
function startRun(seed) {
  restart(state, seed);
  logSeed(state);
  syncUrlSeed(state.seed);
  gameOver.hide();
  const scene = game.registry.get('scene');
  if (scene) scene.rebuildFloor();
  menu.refresh();
  refreshUi();
}

// Permadeath: reset to a fresh floor 1 with a new random (logged) seed.
function handleRestart() {
  startRun(randomSeed());
}

const controller = createController(state, (events) => {
  const scene = game.registry.get('scene');
  if (scene) {
    // Changing floors swaps in a different map, so rebuild the tile/entity visuals.
    if (events.some((e) => e.type === EV.DESCEND || e.type === EV.ASCEND)) {
      scene.rebuildFloor();
    } else scene.render();
    scene.playEvents(events);
  }
  refreshUi();
  if (state.status === 'dead') gameOver.show(state, handleRestart);
});

// Pause/options menu. Its actions call back into startRun (a simulation
// lifecycle function); the menu itself never mutates state or touches Phaser.
const menu = createMenu(document.body, {
  getSeed: () => state.seed,
  // Openable while playing and after death, so a dead player can grab the seed
  // or retry the same dungeon (Restart this seed) from the menu.
  canOpen: () => state.status === 'playing' || state.status === 'dead',
  onOpen: () => controller.cancel(), // stop any auto-walk while paused
  onNewRun: () => startRun(randomSeed()),
  onRestartSeed: () => startRun(state.seed),
  onLoadSeed: (text) => startRun(coerceSeed(text)),
});

// While the menu is open the game is paused: swallow movement/tap commands so
// nothing advances underneath it. The menu overlay already intercepts pointer
// events over the map, so this mainly stops keyboard moves.
function gatedDispatch(command) {
  if (menu.isOpen()) return;
  controller.dispatch(command);
}

attachKeyboard(window, gatedDispatch);

// Convert a client-space pointer position to a tile via the scene's camera
// (fetched lazily, since Phaser boots the scene asynchronously). Keeps the input
// layer free of any renderer import.
function pointerToTile(clientX, clientY) {
  const scene = game.registry.get('scene');
  const canvas = game.canvas;
  if (!scene || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return scene.screenToTile(clientX - rect.left, clientY - rect.top);
}
attachPointer(parent, pointerToTile, gatedDispatch);

refreshUi();

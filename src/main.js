// Composition root. This is the ONLY module allowed to import the renderer
// layer. It wires the simulation, renderer, input, and UI overlays together,
// but never contains gameplay rules itself.
import { createGame, restart } from './core/gameState.js';
import { EV } from './core/events.js';
import { createPhaserGame } from './renderer/phaserConfig.js';
import { createController } from './input/controller.js';
import { attachKeyboard } from './input/keyboard.js';
import { attachPointer } from './input/pointer.js';
import { createHud } from './ui/hud.js';
import { createMessageLog } from './ui/messageLog.js';
import { createGameOver } from './ui/gameOver.js';

function randomSeed() {
  const buf = new Uint32Array(1);
  (window.crypto || window.msCrypto).getRandomValues(buf);
  return buf[0];
}

// Prefer an explicit ?seed= in the URL (to reproduce a run), else a fresh seed.
function chooseSeed() {
  const fromUrl = new URLSearchParams(window.location.search).get('seed');
  if (fromUrl !== null && fromUrl !== '') return fromUrl;
  return randomSeed();
}

function logSeed(state) {
  console.log(
    `[dungeons] seed = ${state.seed} (base36: ${state.seed.toString(36)}) — ` +
      `replay with ?seed=${state.seed}`,
  );
}

const state = createGame(chooseSeed());
logSeed(state);
window.__game = state; // exposed for debugging / reproducibility

const parent = document.getElementById('game');
const game = createPhaserGame(parent, state);

const hud = createHud(document.body);
const messageLog = createMessageLog(document.body);
const gameOver = createGameOver(document.body);

function refreshUi() {
  hud.update(state);
  messageLog.update(state);
}

// Permadeath: reset the run in place to a fresh floor 1 with a new logged seed.
function handleRestart() {
  restart(state, randomSeed());
  logSeed(state);
  gameOver.hide();
  const scene = game.registry.get('scene');
  if (scene) scene.rebuildFloor();
  refreshUi();
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

attachKeyboard(window, controller.dispatch);

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
attachPointer(parent, pointerToTile, controller.dispatch);

refreshUi();

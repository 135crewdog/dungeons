// Composition root. This is the ONLY module allowed to import the renderer
// layer. It wires the simulation, renderer, and input together. As milestones
// land, this file grows to route input into the turn engine and hand state +
// events to the renderer — but it never contains gameplay rules itself.
import { createGame } from './core/gameState.js';
import { createPhaserGame } from './renderer/phaserConfig.js';
import { createController } from './input/controller.js';
import { attachKeyboard } from './input/keyboard.js';

// Pick a seed: an explicit ?seed= in the URL (for reproducing a run) or a fresh
// random one. The seed is logged so any run can be replayed later.
function chooseSeed() {
  const fromUrl = new URLSearchParams(window.location.search).get('seed');
  if (fromUrl !== null && fromUrl !== '') return fromUrl;
  const buf = new Uint32Array(1);
  (window.crypto || window.msCrypto).getRandomValues(buf);
  return buf[0];
}

const seed = chooseSeed();
const state = createGame(seed);
console.log(
  `[dungeons] seed = ${state.seed} (base36: ${state.seed.toString(36)}) — ` +
    `replay with ?seed=${state.seed}`,
);

// Expose for debugging/reproducibility from the console.
window.__game = state;

const parent = document.getElementById('game');
const game = createPhaserGame(parent, state);

// A consumed turn repaints the scene (created asynchronously by Phaser, so it
// is fetched lazily from the registry).
const controller = createController(state, () => {
  const scene = game.registry.get('scene');
  if (scene) scene.render();
});

attachKeyboard(window, controller.dispatch);

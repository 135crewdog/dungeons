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
import { UI_ICONS, SHEET_SIZES } from './renderer/uiIcons.js';
import { createHud } from './ui/hud.js';
import { createMessageLog } from './ui/messageLog.js';
import { createGameOver } from './ui/gameOver.js';
import { createMenu } from './ui/menu.js';
import { createLeaderboard } from './ui/leaderboard.js';
import { createHelp } from './ui/help.js';
import { APP_VERSION } from './ui/version.js';
import { createLeaderboardClient, buildScorePayload } from './net/leaderboard.js';
import { LEADERBOARD_URL } from './net/config.js';

// A fresh run's starting seed. Web Crypto is the good source, but assuming it
// exists threw on browsers that don't have it (or on an insecure origin, where
// some engines withhold it) — and the throw happened at module scope, so the
// game didn't start at all. The fallback is deliberately NOT Math.random: this
// is a startup value, and gameplay randomness must stay inside the seeded RNG
// (tests/architecture.test.js forbids Math.random under src/ for exactly that
// reason). A clock-derived seed is unpredictable enough for picking a dungeon
// and keeps the run just as reproducible once chosen.
function randomSeed() {
  const crypto = window.crypto || window.msCrypto;
  if (crypto && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  }
  console.warn('[dungeons] Web Crypto unavailable — seeding from the clock instead.');
  return Date.now() >>> 0;
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

// Sprite icons for the DOM overlays (Help legend, HUD chips): a <span>
// cropping the real sheet via CSS at 2x, pixelated — the same art the dungeon
// draws. Only this composition root may bridge renderer data into ui/. It
// hands over elements, never HTML strings, so the overlays never have to parse
// markup to show an icon.
const ICON_SCALE = 2;
function spriteIconEl(kind) {
  const spec = UI_ICONS[kind];
  if (!spec) return null;
  const sheet = SHEET_SIZES[spec.url];
  const s = document.createElement('span');
  s.className = 'ui-icon';
  s.style.width = `${spec.w * ICON_SCALE}px`;
  s.style.height = `${spec.h * ICON_SCALE}px`;
  s.style.backgroundImage = `url(${spec.url})`;
  s.style.backgroundPosition = `-${spec.x * ICON_SCALE}px -${spec.y * ICON_SCALE}px`;
  s.style.backgroundSize = `${sheet.width * ICON_SCALE}px ${sheet.height * ICON_SCALE}px`;
  return s;
}
const hud = createHud(document.body, { iconFor: spriteIconEl });
const messageLog = createMessageLog(document.body);

// Cross-device leaderboard client (disabled while LEADERBOARD_URL is empty).
// Failed submissions queue in localStorage; flush on boot and on reconnect.
const lb = createLeaderboardClient({
  url: LEADERBOARD_URL,
  storage: window.localStorage,
  fetchFn: (...args) => fetch(...args),
  now: () => Date.now(),
});
lb.flushQueue();
window.addEventListener('online', () => lb.flushQueue());

// The menu / leaderboard / help (created below) layer over the death screen;
// while any is open it owns the keys, so the death screen's Enter/Space
// restart shortcut stands down. Score submission reads the live state — safe
// because the overlay is only visible while the death state is current.
const gameOver = createGameOver(document.body, {
  isKeyboardBlocked: () => menu.isOpen() || leaderboard.isOpen() || help.isOpen(),
  canSubmit: () => lb.isEnabled(),
  getLastInitials: () => lb.getLastInitials(),
  onSubmitScore: (initials) => {
    lb.setLastInitials(initials);
    return lb.submit(
      buildScorePayload({
        initials,
        floor: state.floor,
        version: APP_VERSION,
        seed: state.seed,
        turns: state.turn,
      }),
    );
  },
  onShowLeaderboard: () => leaderboard.open(),
});

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
    // Changing floors swaps in a different map, so rebuild the tile/entity
    // visuals — and skip the turn's move glide, since the step onto the
    // staircase happened on a floor whose sprites are already gone.
    const changedFloor = events.some((e) => e.type === EV.DESCEND || e.type === EV.ASCEND);
    if (changedFloor) {
      scene.rebuildFloor();
    } else scene.render();
    scene.playEvents(events, { skipMotion: changedFloor });
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
  onLeaderboard: () => leaderboard.open(),
  onHelp: () => help.open(),
  isChildOpen: () => leaderboard.isOpen() || help.isOpen(),
});

// Created after the menu on purpose: their window Escape handlers must run
// after the menu's, so one Escape press closes only the topmost layer (the
// menu defers via isChildOpen, then the child's own handler closes it).
const leaderboard = createLeaderboard(document.body, { fetchScores: () => lb.fetchScores() });
const help = createHelp(document.body, { iconFor: spriteIconEl });

// While the menu (or an overlay layered above it) is open the game is paused:
// swallow movement/tap commands so nothing advances underneath. The overlays
// already intercept pointer events over the map, so this mainly stops
// keyboard moves.
function gatedDispatch(command) {
  if (menu.isOpen() || leaderboard.isOpen() || help.isOpen()) return;
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

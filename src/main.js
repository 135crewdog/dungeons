// Composition root. This is the ONLY module allowed to import the renderer
// layer. It wires the simulation, renderer, and input together. As milestones
// land, this file grows to construct game state, route input into the turn
// engine, and hand state + events to the renderer — but it never contains
// gameplay rules itself.
import { createPhaserGame } from './renderer/phaserConfig.js';

const parent = document.getElementById('game');
createPhaserGame(parent);

import { describe, it, expect } from 'vitest';
import { processCommand } from '../src/core/turnEngine.js';
import { updateVisibility } from '../src/systems/visibility.js';
import { createEnemy } from '../src/entities/enemies.js';
import { createPotion } from '../src/entities/items.js';
import { ENEMY_TYPES, TILE } from '../src/core/constants.js';
import { idx } from '../src/core/query.js';

// Integrated turn-order guards: the briefing's strict sequence, exercised
// through processCommand with enemies actually present (the unit tests
// elsewhere use enemy-free states). An 13x3 corridor along y=1.
function corridorState({ playerX, playerHp = 20, rngSeed = 1, doorX = null } = {}) {
  const width = 13;
  const height = 3;
  const tiles = new Uint8Array(width * height); // all WALL
  const roomAt = new Int16Array(width * height).fill(-1);
  const map = { width, height, tiles, rooms: [], roomAt, stairsDown: null, stairsUp: null };
  for (let x = 1; x <= width - 2; x++) tiles[idx(map, x, 1)] = TILE.FLOOR;
  if (doorX !== null) tiles[idx(map, doorX, 1)] = TILE.DOOR;
  const player = {
    id: 1,
    kind: 'player',
    x: playerX,
    y: 1,
    hp: playerHp,
    maxHp: 20,
    attackDie: 8,
    glyph: '@',
    strength: 0,
    skill: 0,
    armor: 0,
  };
  const state = {
    rng: { seed: rngSeed, s: rngSeed },
    status: 'playing',
    turn: 0,
    floor: 1,
    log: [],
    items: [],
    path: null,
    floors: new Map(),
    map,
    vis: { visible: new Uint8Array(width * height), explored: new Uint8Array(width * height) },
    entities: { nextId: 10, playerId: 1, byId: new Map([[1, player]]) },
  };
  return { state, player };
}

function addEnemy(state, x, y, id, { aggro = true } = {}) {
  const e = createEnemy(ENEMY_TYPES.goblin, x, y, 1);
  e.id = id;
  if (aggro) {
    e.aggro = true;
    e.lastSeen = { x: state.entities.byId.get(1).x, y: state.entities.byId.get(1).y };
  }
  state.entities.byId.set(id, e);
  return e;
}

describe('turn order with enemies present', () => {
  it('enemies act in ascending id order regardless of Map insertion order', () => {
    // e7 inserted FIRST but must act after e3. After the player's step right,
    // e7 (adjacent) attacks and e3 (two away) moves — e3's move event must
    // precede e7's attack event.
    const { state } = corridorState({ playerX: 5 });
    addEnemy(state, 7, 1, 7);
    const e3 = addEnemy(state, 3, 1, 3);
    updateVisibility(state);
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    const e3Move = events.findIndex((e) => e.type === 'move' && e.id === 3);
    const e7Attack = events.findIndex((e) => e.type === 'attack' && e.attackerId === 7);
    expect(e3Move).toBeGreaterThan(-1);
    expect(e7Attack).toBeGreaterThan(-1);
    expect(e3Move).toBeLessThan(e7Attack);
    expect(e3.x).toBe(4);
  });

  it('an enemy attacks if adjacent, ELSE moves — closing the gap costs its turn', () => {
    // e3 starts two tiles behind the player's destination: it steps adjacent
    // on this turn and must NOT also attack this same turn.
    const { state } = corridorState({ playerX: 5 });
    const e3 = addEnemy(state, 3, 1, 3);
    updateVisibility(state);
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(e3.x).toBe(4); // closed the gap (player is at 6)...
    expect(events.some((e) => e.type === 'attack' && e.attackerId === 3)).toBe(false); // ...without attacking
    // Step back into melee range: now the enemy is adjacent at its turn, so it
    // attacks and does NOT move.
    const events2 = processCommand(state, { type: 'move', dx: -1, dy: 0 });
    expect(events2.some((e) => e.type === 'attack' && e.attackerId === 3)).toBe(true);
    expect(events2.some((e) => e.type === 'move' && e.id === 3)).toBe(false);
    expect(e3.x).toBe(4);
  });

  it('FOV updates before the enemy phase: stepping into a doorway aggros this turn', () => {
    // Door at x=5 separates the player (x=4) from a holding enemy (x=8).
    // The step INTO the doorway exposes both sides; because visibility is
    // recomputed before enemies act, the enemy aggros and moves this turn.
    const { state } = corridorState({ playerX: 4, doorX: 5 });
    const e = addEnemy(state, 8, 1, 4, { aggro: false });
    updateVisibility(state);
    expect(e.aggro).toBe(false);
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(e.aggro).toBe(true);
    expect(e.x).toBe(7); // it already chased one step in the same turn
  });

  it('item pickups resolve after the enemy phase (attack event precedes pickup)', () => {
    const { state } = corridorState({ playerX: 5 });
    addEnemy(state, 7, 1, 2);
    const pot = createPotion(6, 1);
    pot.id = 9;
    state.items.push(pot);
    updateVisibility(state);
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    const attackIdx = events.findIndex((e) => e.type === 'attack');
    const pickupIdx = events.findIndex((e) => e.type === 'pickup');
    expect(attackIdx).toBeGreaterThan(-1);
    expect(pickupIdx).toBeGreaterThan(-1);
    expect(attackIdx).toBeLessThan(pickupIdx);
  });

  it('a player killed mid-phase stops the phase: later enemies never act, loot never resolves', () => {
    // Seed 1 makes the first attacker's swing land (verified deterministic);
    // at 1 HP that kill must halt the remaining enemy AND skip the potion
    // under the player's feet.
    const { state } = corridorState({ playerX: 5, playerHp: 1, rngSeed: 1 });
    addEnemy(state, 7, 1, 2); // acts first (lower id), adjacent after the step
    addEnemy(state, 4, 1, 8); // must never act once the player is dead
    const pot = createPotion(6, 1);
    pot.id = 9;
    state.items.push(pot);
    updateVisibility(state);
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    const deathIdx = events.findIndex((e) => e.type === 'death' && e.kind === 'player');
    expect(deathIdx).toBeGreaterThan(-1);
    expect(state.status).toBe('dead');
    expect(events.slice(deathIdx + 1)).toHaveLength(0); // nothing after the kill
    expect(events.some((e) => e.type === 'pickup')).toBe(false);
    expect(state.items).toHaveLength(1); // potion still on the floor
  });
});

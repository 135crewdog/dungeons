import { describe, it, expect } from 'vitest';
import { processCommand } from '../src/core/turnEngine.js';
import { resolveAttack } from '../src/systems/combat.js';
import { createRng } from '../src/core/rng.js';
import { updateVisibility } from '../src/systems/visibility.js';
import { createEnemy } from '../src/entities/enemies.js';
import { ENEMY_TYPES, TILE, PLAYER_MAX_HP } from '../src/core/constants.js';
import { idx } from '../src/core/query.js';
import { EV } from '../src/core/events.js';

// A horizontal corridor (y=1, x=1..12 in a 14x3 wall field) with real
// visibility, optional door, stairs, items, and frozen enemies.
function corridor({
  playerX = 2,
  playerHp = PLAYER_MAX_HP,
  doorX = null,
  stairsDownX = null,
  items = [],
  enemies = [],
  ring = null,
} = {}) {
  const width = 14;
  const height = 3;
  const tiles = new Uint8Array(width * height); // WALL
  const map = {
    width,
    height,
    tiles,
    rooms: [],
    roomAt: new Int16Array(width * height).fill(-1),
    stairsDown: null,
    stairsUp: null,
  };
  for (let x = 1; x <= 12; x++) tiles[idx(map, x, 1)] = TILE.FLOOR;
  if (doorX !== null) tiles[idx(map, doorX, 1)] = TILE.DOOR;
  if (stairsDownX !== null) {
    tiles[idx(map, stairsDownX, 1)] = TILE.STAIRS_DOWN;
    map.stairsDown = { x: stairsDownX, y: 1 };
  }
  const player = {
    id: 1,
    kind: 'player',
    x: playerX,
    y: 1,
    hp: playerHp,
    maxHp: PLAYER_MAX_HP,
    attackDie: 8,
    skill: 0,
    strength: 0,
    armor: 0,
    keys: 0,
    glyph: '@',
  };
  if (ring) player[ring] = true;
  const state = {
    seed: 1,
    rng: createRng(1),
    status: 'playing',
    turn: 0,
    floor: 1,
    map,
    vis: { visible: new Uint8Array(width * height), explored: new Uint8Array(width * height) },
    entities: { nextId: 10, playerId: 1, byId: new Map([[1, player]]) },
    items,
    path: null,
    floors: new Map(),
    log: [],
  };
  let id = 2;
  for (const { x, y, frozen = true } of enemies) {
    const e = createEnemy(ENEMY_TYPES.goblin, x, y, 1);
    e.id = id++;
    if (frozen) e.moveCooldown = 99; // hold position; attacking is never gated
    state.entities.byId.set(e.id, e);
  }
  state.vis.explored.fill(1);
  updateVisibility(state);
  return { state, player };
}

const playerAttacks = (events) => events.filter((e) => e.type === EV.ATTACK && e.attackerId === 1);
const playerMoves = (events) => events.filter((e) => e.type === EV.MOVE && e.id === 1);

describe('Ring of Shadow', () => {
  it('an unprovoked enemy never aggroes, even with clear line of sight', () => {
    const { state } = corridor({ ring: 'ringShadow', enemies: [{ x: 6, y: 1 }] });
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    const goblin = state.entities.byId.get(2);
    expect(goblin.aggro ?? false).toBe(false);
  });

  it('an unprovoked adjacent enemy does not attack a hidden player', () => {
    const { state, player } = corridor({
      playerX: 4,
      ring: 'ringShadow',
      enemies: [{ x: 6, y: 1 }],
    });
    processCommand(state, { type: 'move', dx: 1, dy: 0 }); // step right up next to it
    expect(player.x).toBe(5); // adjacent to the goblin now
    expect(player.hp).toBe(PLAYER_MAX_HP); // no swing came
    expect(state.entities.byId.get(2).aggro ?? false).toBe(false);
  });

  it('attacking an enemy provokes that one — and only that one', () => {
    const { state } = corridor({
      playerX: 5,
      ring: 'ringShadow',
      enemies: [
        { x: 6, y: 1 },
        { x: 10, y: 1 },
      ],
    });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 }); // bump-attack
    expect(playerAttacks(events)).toHaveLength(1);
    const struck = state.entities.byId.get(2);
    const bystander = state.entities.byId.get(3);
    expect(struck.provoked).toBe(true);
    expect(struck.aggro).toBe(true); // saw the player the moment cover broke
    expect(bystander.provoked ?? false).toBe(false);
    expect(bystander.aggro ?? false).toBe(false); // still oblivious
  });
});

describe('Ring of Sight', () => {
  it('marks the whole floor explored but leaves true visibility (and aggro) alone', () => {
    const { state } = corridor({
      ring: 'ringSight',
      doorX: 5,
      enemies: [{ x: 9, y: 1 }],
    });
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(state.vis.explored.every((v) => v === 1)).toBe(true);
    expect(state.vis.visible[idx(state.map, 9, 1)]).toBe(0); // door still blocks sight
    expect(state.entities.byId.get(2).aggro ?? false).toBe(false); // no dinner bell
  });
});

describe('Ring of Speed', () => {
  it('moves two tiles in one turn (one turn consumed)', () => {
    const { state, player } = corridor({ ring: 'ringSpeed' });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.x).toBe(4);
    expect(state.turn).toBe(1);
    expect(playerMoves(events)).toHaveLength(2);
  });

  it('honors single: true (auto-walk path corners)', () => {
    const { state, player } = corridor({ ring: 'ringSpeed' });
    processCommand(state, { type: 'move', dx: 1, dy: 0, single: true });
    expect(player.x).toBe(3);
  });

  it('a bump-attack consumes the whole turn — no free step after a swing', () => {
    const { state, player } = corridor({ ring: 'ringSpeed', enemies: [{ x: 3, y: 1 }] });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(playerAttacks(events)).toHaveLength(1);
    expect(player.x).toBe(2); // never moved
  });

  it('the second step never attacks: an occupied tile is silently skipped', () => {
    const { state, player } = corridor({ ring: 'ringSpeed', enemies: [{ x: 4, y: 1 }] });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.x).toBe(3); // first step only
    expect(playerAttacks(events)).toHaveLength(0);
  });

  it('stepping onto loot forfeits the second step and collects it', () => {
    const { state, player } = corridor({
      playerHp: 10,
      ring: 'ringSpeed',
      items: [{ id: 20, type: 'potion', x: 3, y: 1, heal: 8 }],
    });
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.x).toBe(3); // stopped over the loot
    expect(state.items).toHaveLength(0); // and picked it up
    expect(player.hp).toBe(18);
  });

  it('a second step onto stairs descends (and ends the turn there)', () => {
    const { state } = corridor({ ring: 'ringSpeed', stairsDownX: 4 });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(state.floor).toBe(2);
    expect(events.filter((e) => e.type === EV.DESCEND)).toHaveLength(1);
    expect(state.turn).toBe(1); // one command, one turn — even ending on stairs
  });

  it('a first step onto stairs forfeits the second step entirely', () => {
    const { state } = corridor({ ring: 'ringSpeed', stairsDownX: 3 });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(state.floor).toBe(2);
    expect(events.filter((e) => e.type === EV.DESCEND)).toHaveLength(1);
    expect(playerMoves(events)).toHaveLength(1); // exactly one step happened
    expect(state.turn).toBe(1); // the forfeited step doesn't cost a second turn
  });

  it('the in-between tile gets its own FOV pass on the way through', () => {
    // A double step THROUGH a doorway: the corridor behind the door is only
    // in view from inside the doorway itself (the mid-step position). Without
    // the mid-step visibility update, the tiles behind the player would never
    // be marked explored — the end-of-turn FOV can't see back through the
    // closed door.
    const { state, player } = corridor({ playerX: 3, doorX: 4, ring: 'ringSpeed' });
    state.vis.explored.fill(0);
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.x).toBe(5); // stepped into the doorway, then through it
    expect(state.vis.explored[idx(state.map, 2, 1)]).toBe(1); // seen from the doorway
  });
});

describe('Ring of Survival', () => {
  it('cheats death from a chest trap, once', () => {
    const { state, player } = corridor({
      playerHp: 5,
      ring: 'ringSurvival',
      items: [
        { id: 21, type: 'chest', x: 3, y: 1, effect: 'trap', amount: 25 },
        { id: 22, type: 'chest', x: 4, y: 1, effect: 'trap', amount: 25 },
      ],
    });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(state.status).toBe('playing');
    expect(player.hp).toBe(PLAYER_MAX_HP); // restored to full
    expect(player.ringSurvival).toBe(false); // and spent
    expect(events.filter((e) => e.type === EV.SURVIVAL)).toHaveLength(1);
    expect(state.log.some((e) => e.type === 'survival')).toBe(true);

    processCommand(state, { type: 'move', dx: 1, dy: 0 }); // the second trap
    expect(state.status).toBe('dead'); // no second miracle
    expect(player.hp).toBe(0);
  });

  it('cheats death from an enemy hit, once', () => {
    const { state, player } = corridor({ ring: 'ringSurvival', enemies: [{ x: 3, y: 1 }] });
    const goblin = state.entities.byId.get(2);
    goblin.skill = 100; // never misses (except a natural 1)
    goblin.strength = 100; // every hit is lethal from full HP
    let survived = false;
    for (let i = 0; i < 10 && !survived; i++) {
      const events = resolveAttack(state, goblin.id, player.id);
      survived = events.some((e) => e.type === EV.SURVIVAL);
    }
    expect(survived).toBe(true);
    expect(player.ringSurvival).toBe(false);
    expect(state.status).toBe('playing');
    expect(player.hp).toBe(PLAYER_MAX_HP);

    let dead = false;
    for (let i = 0; i < 10 && !dead; i++) {
      resolveAttack(state, goblin.id, player.id);
      dead = state.status === 'dead';
    }
    expect(dead).toBe(true); // the ring only fires once
    expect(state.log.filter((e) => e.type === 'survival')).toHaveLength(1);
  });
});

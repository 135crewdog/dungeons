import { describe, it, expect } from 'vitest';
import { processCommand } from '../src/core/turnEngine.js';
import { resolveAttack } from '../src/systems/combat.js';
import { createRng } from '../src/core/rng.js';
import { updateVisibility } from '../src/systems/visibility.js';
import { createEnemy } from '../src/entities/enemies.js';
import {
  ENEMY_TYPES,
  TILE,
  PLAYER_MAX_HP,
  SHADOW_NOISE_RADIUS,
  SHADOW_NOTICE_RADIUS,
  SURVIVAL_HEAL_FRACTION,
} from '../src/core/constants.js';
import { idx, hiddenFromEnemy } from '../src/core/query.js';
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
  for (const { x, y, kind = 'goblin', frozen = true } of enemies) {
    const e = createEnemy(ENEMY_TYPES[kind], x, y, 1);
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
  it('an unprovoked enemy at range never aggroes, even with clear line of sight', () => {
    // Player 2 -> 3, goblin at 6: distance 3, comfortably outside NOTICE.
    const { state } = corridor({ ring: 'ringShadow', enemies: [{ x: 6, y: 1 }] });
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    const goblin = state.entities.byId.get(2);
    expect(goblin.aggro ?? false).toBe(false);
  });

  it('an adjacent enemy notices a hidden player and swings', () => {
    const { state, player } = corridor({
      playerX: 4,
      ring: 'ringShadow',
      enemies: [{ x: 6, y: 1 }],
    });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(player.x).toBe(5); // adjacent to the goblin now
    const goblin = state.entities.byId.get(2);
    expect(goblin.aggro).toBe(true); // too close to hide from
    // Assert on the swing, not on HP: the attack roll is allowed to miss.
    expect(events.filter((e) => e.type === EV.ATTACK && e.attackerId === goblin.id)).toHaveLength(
      1,
    );
  });

  it('an enemy just outside the notice radius stays hidden from', () => {
    const { state, player } = corridor({
      playerX: 2,
      ring: 'ringShadow',
      enemies: [{ x: 2 + SHADOW_NOTICE_RADIUS + 1, y: 1 }],
    });
    const goblin = state.entities.byId.get(2);
    expect(hiddenFromEnemy(state, goblin)).toBe(true);
    expect(player.x).toBe(2);
  });

  it('a swing is heard by everyone in earshot; distant bystanders stay oblivious', () => {
    const { state } = corridor({
      playerX: 5,
      ring: 'ringShadow',
      enemies: [
        { x: 6, y: 1 }, // the target
        { x: 5 + SHADOW_NOISE_RADIUS - 1, y: 1 }, // inside earshot
        { x: 5 + SHADOW_NOISE_RADIUS + 1, y: 1 }, // outside it
      ],
    });
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 }); // bump-attack
    expect(playerAttacks(events)).toHaveLength(1);
    expect(state.entities.byId.get(2).provoked).toBe(true); // struck
    expect(state.entities.byId.get(3).provoked).toBe(true); // heard it
    expect(state.entities.byId.get(4).provoked ?? false).toBe(false); // too far
  });

  it('an enemy exactly at the noise radius hears the swing', () => {
    const { state } = corridor({
      playerX: 5,
      ring: 'ringShadow',
      enemies: [
        { x: 6, y: 1 },
        { x: 5 + SHADOW_NOISE_RADIUS, y: 1 },
      ],
    });
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(state.entities.byId.get(3).provoked).toBe(true);
  });

  it('a miss is exactly as loud as a hit', () => {
    const { state, player } = corridor({
      playerX: 5,
      ring: 'ringShadow',
      enemies: [
        { x: 6, y: 1 },
        { x: 5 + SHADOW_NOISE_RADIUS - 1, y: 1 },
      ],
    });
    player.skill = -100; // roll + skill can never clear the threshold
    const events = processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(playerAttacks(events).every((e) => e.hit === false)).toBe(true);
    expect(state.entities.byId.get(3).provoked).toBe(true);
  });

  it('noise carries through a closed door — but it is sound, not sight', () => {
    const { state } = corridor({
      playerX: 5,
      doorX: 8, // opaque: breaks line of sight to the bystander beyond it
      ring: 'ringShadow',
      enemies: [
        { x: 6, y: 1 },
        { x: 9, y: 1 },
      ],
    });
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    const bystander = state.entities.byId.get(3);
    expect(bystander.provoked).toBe(true); // heard it through the door
    expect(bystander.aggro ?? false).toBe(false); // but still cannot see
  });

  it('a boss is never fooled by the ring', () => {
    const { state } = corridor({
      playerX: 2,
      ring: 'ringShadow',
      enemies: [{ x: 6, y: 1, kind: 'boss' }],
    });
    const boss = state.entities.byId.get(2);
    expect(hiddenFromEnemy(state, boss)).toBe(false);
    processCommand(state, { type: 'move', dx: 1, dy: 0 });
    expect(boss.aggro).toBe(true);
  });
});

describe('hiddenFromEnemy', () => {
  const probe = (opts) => {
    const { state } = corridor(opts);
    return hiddenFromEnemy(state, state.entities.byId.get(2));
  };

  it('is false without the ring', () => {
    expect(probe({ playerX: 2, enemies: [{ x: 8, y: 1 }] })).toBe(false);
  });

  it('is true for a far, unprovoked, non-boss enemy while the ring is worn', () => {
    expect(probe({ playerX: 2, ring: 'ringShadow', enemies: [{ x: 8, y: 1 }] })).toBe(true);
  });

  it('is false once the enemy is provoked', () => {
    const { state } = corridor({ playerX: 2, ring: 'ringShadow', enemies: [{ x: 8, y: 1 }] });
    const goblin = state.entities.byId.get(2);
    goblin.provoked = true;
    expect(hiddenFromEnemy(state, goblin)).toBe(false);
  });

  it('is false at knife range', () => {
    expect(probe({ playerX: 2, ring: 'ringShadow', enemies: [{ x: 3, y: 1 }] })).toBe(false);
  });

  it('is false for a boss', () => {
    expect(probe({ playerX: 2, ring: 'ringShadow', enemies: [{ x: 8, y: 1, kind: 'boss' }] })).toBe(
      false,
    );
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

// Half the bar, rounded up — derived from the constant so a re-tune moves the
// expectation with it rather than leaving a stale literal behind.
const SURVIVAL_HP = Math.max(1, Math.ceil(PLAYER_MAX_HP * SURVIVAL_HEAL_FRACTION));

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
    expect(player.hp).toBe(SURVIVAL_HP); // a second wind, not a reset
    expect(player.hp).toBeLessThan(PLAYER_MAX_HP);
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
    expect(player.hp).toBe(SURVIVAL_HP);

    let dead = false;
    for (let i = 0; i < 10 && !dead; i++) {
      resolveAttack(state, goblin.id, player.id);
      dead = state.status === 'dead';
    }
    expect(dead).toBe(true); // the ring only fires once
    expect(state.log.filter((e) => e.type === 'survival')).toHaveLength(1);
  });
});

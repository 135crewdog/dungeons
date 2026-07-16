// Fixture discovery: scan seeds with the REAL engine and emit fixtures.json.
// Every browser scenario replays a command stream that was pre-simulated here,
// so browser-vs-engine divergence is itself a finding (parity).
import { writeFileSync } from 'node:fs';
import { createGame } from '../src/core/gameState.js';
import {
  processCommand,
  planPath,
  nextPathStep,
  pathFinished,
  clearPath,
} from '../src/core/turnEngine.js';
import { getPlayer, isWalkable, isVisible, idx, tileAt } from '../src/core/query.js';
import { TILE } from '../src/core/constants.js';
import { POLICIES } from '../scripts/balance/policies.js';

const DIR_TO_CODE = {
  '0,-1': 'Numpad8',
  '1,-1': 'Numpad9',
  '1,0': 'Numpad6',
  '1,1': 'Numpad3',
  '0,1': 'Numpad2',
  '-1,1': 'Numpad1',
  '-1,0': 'Numpad4',
  '-1,-1': 'Numpad7',
};
const codeOf = (d) => DIR_TO_CODE[`${d.dx},${d.dy}`];

function snapshot(state) {
  const p = getPlayer(state);
  const entities = [...state.entities.byId.values()]
    .map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, hp: e.hp }))
    .sort((a, b) => a.id - b.id);
  const items = state.items
    .map((i) => ({ id: i.id, type: i.type, x: i.x, y: i.y }))
    .sort((a, b) => a.id - b.id);
  let explored = 0,
    visible = 0;
  for (let i = 0; i < state.vis.explored.length; i++) {
    explored += state.vis.explored[i];
    visible += state.vis.visible[i];
  }
  let mapHash = 0;
  for (let i = 0; i < state.map.tiles.length; i++)
    mapHash = (mapHash * 31 + state.map.tiles[i]) >>> 0;
  return {
    turn: state.turn,
    floor: state.floor,
    status: state.status,
    player: {
      x: p.x,
      y: p.y,
      hp: p.hp,
      maxHp: p.maxHp,
      strength: p.strength ?? 0,
      skill: p.skill ?? 0,
      armor: p.armor ?? 0,
    },
    entities,
    items,
    explored,
    visible,
    mapHash,
  };
}

// --- S_MOVE: spawn with a straight >=4-tile in-room line + an adjacent wall, and a
// 4-step auto-walk that completes without any cancellation trigger.
function findMoveSeed() {
  outer: for (let seed = 1; seed <= 500; seed++) {
    const state = createGame(seed);
    const p = getPlayer(state);
    const LINE_LEN = 3;
    const cardinals = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    const all8 = [
      ...cardinals,
      { dx: 1, dy: 1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 1 },
      { dx: -1, dy: -1 },
    ];
    let line = null;
    for (const d of all8) {
      let ok = true;
      for (let k = 1; k <= LINE_LEN; k++)
        if (!isWalkable(state.map, p.x + d.dx * k, p.y + d.dy * k)) {
          ok = false;
          break;
        }
      if (ok && !line) line = d;
    }
    if (!line) continue;
    // the wall-bump assertion happens at the END of the line (near the room edge):
    const endX = p.x + line.dx * LINE_LEN,
      endY = p.y + line.dy * LINE_LEN;
    let wallDir = null;
    for (const d of cardinals) {
      if (!isWalkable(state.map, endX + d.dx, endY + d.dy)) {
        wallDir = d;
        break;
      }
    }
    if (!wallDir) continue;
    // simulate the auto-walk with controller-equivalent cancellation checks
    const target = { x: p.x + line.dx * LINE_LEN, y: p.y + line.dy * LINE_LEN };
    if (!planPath(state, target.x, target.y)) continue;
    const baseline = new Set();
    for (const e of state.entities.byId.values())
      if (e.id !== 1 && isVisible(state, e.x, e.y)) baseline.add(e.id);
    for (let step = 0; step < LINE_LEN; step++) {
      const s = nextPathStep(state);
      if (!s) continue outer;
      const hp0 = getPlayer(state).hp;
      const tx = getPlayer(state).x + s.dx,
        ty = getPlayer(state).y + s.dy;
      processCommand(state, { type: 'move', dx: s.dx, dy: s.dy });
      const pp = getPlayer(state);
      if (state.status !== 'playing' || pp.x !== tx || pp.y !== ty || pp.hp < hp0) continue outer;
      for (const e of state.entities.byId.values()) {
        if (e.id !== 1 && isVisible(state, e.x, e.y) && !baseline.has(e.id)) continue outer;
      }
    }
    if (!pathFinished(state)) continue;
    clearPath(state);
    // confirm the wall-bump at the line end refuses the turn (engine truth)
    const turnBefore = state.turn;
    const bumpEvents = processCommand(state, { type: 'move', dx: wallDir.dx, dy: wallDir.dy });
    if (bumpEvents.length !== 0 || state.turn !== turnBefore) continue;
    const fresh = createGame(seed);
    const fp = getPlayer(fresh);
    return {
      seed,
      spawn: { x: fp.x, y: fp.y },
      line,
      wallDir,
      clickTarget: target,
      boot: snapshot(fresh),
    };
  }
  throw new Error('no S_MOVE seed found');
}

// --- S_TRIP: rusher reaches floor 2 alive; record commands, then a 2-step off/on
// return to floor 1. Also mine the trace for a door crossing with an occlusion flip
// and a player bump-attack.
function findTripSeed() {
  outer: for (let seed = 1; seed <= 500; seed++) {
    const state = createGame(seed);
    const preDescend = { mapHash: snapshot(state).mapHash };
    const cmds = [];
    const policy = POLICIES.rusher;
    let doorFix = null;
    let fightAt = -1;
    for (let t = 0; t < 400; t++) {
      if (state.status !== 'playing') continue outer;
      if (state.floor === 2) break;
      const step = policy.decide(state);
      if (!step) continue outer;
      const p = getPlayer(state);
      const landX = p.x + step.dx,
        landY = p.y + step.dy;
      const landsOnDoor = tileAt(state.map, landX, landY) === TILE.DOOR;
      // visibility of the tile 2 ahead BEFORE the step (for the occlusion flip)
      const aheadX = p.x + step.dx * 2,
        aheadY = p.y + step.dy * 2;
      const aheadVisibleBefore = isVisible(state, aheadX, aheadY);
      const events = processCommand(state, { type: 'move', dx: step.dx, dy: step.dy });
      if (events.length === 0) continue outer; // wedged bot; skip seed
      cmds.push({ c: codeOf(step), t: state.turn, f: state.floor });
      if (fightAt === -1 && events.some((e) => e.type === 'attack' && e.attackerId === 1))
        fightAt = cmds.length;
      if (!doorFix && landsOnDoor && state.floor === 1) {
        const pp = getPlayer(state);
        if (pp.x === landX && pp.y === landY && isWalkable(state.map, aheadX, aheadY)) {
          const aheadVisibleAfter = isVisible(state, aheadX, aheadY);
          if (!aheadVisibleBefore && aheadVisibleAfter) {
            doorFix = { atCommand: cmds.length, ahead: { x: aheadX, y: aheadY } };
          }
        }
      }
    }
    if (state.floor !== 2 || state.status !== 'playing') continue;
    const arrivedFloor2 = snapshot(state);
    // step off the up-stairs and back on -> ascend
    const p = getPlayer(state);
    let off = null;
    for (const d of Object.values({
      a: { dx: 1, dy: 0 },
      b: { dx: -1, dy: 0 },
      c: { dx: 0, dy: 1 },
      d: { dx: 0, dy: -1 },
    })) {
      if (isWalkable(state.map, p.x + d.dx, p.y + d.dy)) {
        off = d;
        break;
      }
    }
    if (!off) continue;
    const back = { dx: -off.dx, dy: -off.dy };
    const ev1 = processCommand(state, { type: 'move', ...off });
    if (state.status !== 'playing') continue;
    const offRec = { c: codeOf(off), t: state.turn, f: state.floor };
    const ev2 = processCommand(state, { type: 'move', ...back });
    if (state.floor !== 1 || state.status !== 'playing') continue; // e.g. bumped an enemy instead of stepping back
    cmds.push(offRec);
    cmds.push({ c: codeOf(back), t: state.turn, f: state.floor });
    return {
      seed,
      cmds,
      fightAt: fightAt === -1 ? null : fightAt,
      doorFix,
      floor1MapHash: preDescend.mapHash,
      arrivedFloor2Turn: arrivedFloor2.turn,
      final: snapshot(state), // the parity oracle: after ALL cmds, incl. the round trip
    };
  }
  throw new Error('no S_TRIP seed found');
}

// --- S_FIGHT: earliest player-attack via a hunt policy (greedy toward nearest enemy).
function findFightSeed() {
  outer: for (let seed = 1; seed <= 500; seed++) {
    const state = createGame(seed);
    const cmds = [];
    for (let t = 0; t < 120; t++) {
      if (state.status !== 'playing') continue outer;
      const p = getPlayer(state);
      let nearest = null;
      for (const e of state.entities.byId.values()) {
        if (e.id === 1) continue;
        const d = Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y));
        if (!nearest || d < nearest.d) nearest = { e, d };
      }
      if (!nearest) continue outer;
      // plan over walkable terrain toward the enemy tile (goal allowed)
      if (!planPathToEntity(state, nearest.e)) continue outer;
      const s = state.__step;
      const events = processCommand(state, { type: 'move', dx: s.dx, dy: s.dy });
      if (events.length === 0) continue outer;
      cmds.push({ c: codeOf(s), t: state.turn, f: state.floor });
      if (events.some((e) => e.type === 'attack' && e.attackerId === 1)) {
        if (getPlayer(state).hp < 8) continue outer; // keep margin for the death scenario
        return { seed, cmds, after: snapshot(state) };
      }
    }
  }
  throw new Error('no S_FIGHT seed found');
}
import { aStar } from '../src/systems/pathfinding.js';
import { entityAt } from '../src/core/query.js';
function planPathToEntity(state, target) {
  const p = getPlayer(state);
  const passable = (x, y) => {
    if (!isWalkable(state.map, x, y)) return false;
    if (x === target.x && y === target.y) return true;
    return !entityAt(state, x, y);
  };
  const path = aStar(passable, { x: p.x, y: p.y }, { x: target.x, y: target.y }, state.map.width);
  if (!path || path.length < 2) return false;
  state.__step = { dx: path[1].x - p.x, dy: path[1].y - p.y };
  return true;
}

// --- S_SKILL: a floor-1 skill chest in the spawn room, reachable by a short safe walk.
function findSkillSeed() {
  outer: for (let seed = 1; seed <= 2000; seed++) {
    const state = createGame(seed);
    const p = getPlayer(state);
    const room0 = state.map.rooms[0];
    const chest = state.items.find(
      (i) =>
        i.type === 'chest' &&
        i.effect === 'skill' &&
        i.x >= room0.x &&
        i.x < room0.x + room0.w &&
        i.y >= room0.y &&
        i.y < room0.y + room0.h,
    );
    if (!chest) continue;
    // simulate walking to it (terrain A*, enemies unlikely inside room 0 — they never spawn there)
    const cmds = [];
    for (let t = 0; t < 40; t++) {
      const pp = getPlayer(state);
      if (pp.x === chest.x && pp.y === chest.y) break;
      if (!planPathToEntity(state, { x: chest.x, y: chest.y })) continue outer;
      const s = state.__step;
      const ev = processCommand(state, { type: 'move', dx: s.dx, dy: s.dy });
      if (ev.length === 0 || state.status !== 'playing') continue outer;
      cmds.push({ c: codeOf(s), t: state.turn, f: state.floor });
      if (getPlayer(state).skill > 0) {
        return {
          seed,
          chest: { x: chest.x, y: chest.y },
          cmds,
          skillAfter: getPlayer(state).skill,
        };
      }
    }
  }
  return null; // acceptable: fall back to staging via __game
}

const fixtures = {
  move: findMoveSeed(),
  trip: findTripSeed(),
  fight: findFightSeed(),
  skill: findSkillSeed(),
};
writeFileSync(new URL('./fixtures.json', import.meta.url), JSON.stringify(fixtures, null, 2));
console.log(
  'S_MOVE seed',
  fixtures.move.seed,
  '| spawn',
  JSON.stringify(fixtures.move.spawn),
  '| line',
  JSON.stringify(fixtures.move.line),
);
console.log(
  'S_TRIP seed',
  fixtures.trip.seed,
  '| cmds',
  fixtures.trip.cmds.length,
  '| fightAt',
  fixtures.trip.fightAt,
  '| doorFix',
  JSON.stringify(fixtures.trip.doorFix),
);
console.log('S_FIGHT seed', fixtures.fight.seed, '| cmds', fixtures.fight.cmds.length);
console.log(
  'S_SKILL',
  fixtures.skill
    ? `seed ${fixtures.skill.seed} cmds ${fixtures.skill.cmds.length}`
    : 'none found <=2000 (will stage via __game)',
);

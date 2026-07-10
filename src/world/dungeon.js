// Procedural floor generator. Orchestrates room placement, corridor + door
// carving, and stairs. Returns a fresh map object; it does not touch entities
// (population is a separate step). Consumes the single game RNG so every floor
// is reproducible from the run's seed.

import { TILE, MAP_WIDTH, MAP_HEIGHT } from '../core/constants.js';
import { idx } from '../core/query.js';
import { placeRooms, carveRooms, roomCenter } from './rooms.js';
import { connectRooms } from './corridors.js';

export function generateFloor(rng, floorNumber, width = MAP_WIDTH, height = MAP_HEIGHT) {
  const tiles = new Uint8Array(width * height); // 0 === TILE.WALL
  const roomAt = new Int16Array(width * height).fill(-1);
  const map = { width, height, tiles, rooms: [], roomAt, stairs: null };

  const rooms = placeRooms(rng, width, height);
  map.rooms = rooms;
  carveRooms(map, rooms);
  connectRooms(map, rng, rooms);
  placeStairs(map, rooms);
  return map;
}

// Place the down-stairs in the room whose center is farthest (Manhattan) from
// the first room, where the player starts — so the exit is never underfoot.
function placeStairs(map, rooms) {
  const origin = roomCenter(rooms[0]);
  let best = rooms[0];
  let bestDist = -1;
  for (const room of rooms) {
    const c = roomCenter(room);
    const d = Math.abs(c.x - origin.x) + Math.abs(c.y - origin.y);
    if (d > bestDist) {
      bestDist = d;
      best = room;
    }
  }
  const c = roomCenter(best);
  map.tiles[idx(map, c.x, c.y)] = TILE.STAIRS;
  map.stairs = { x: c.x, y: c.y };
}

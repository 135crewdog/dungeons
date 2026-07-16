// Room placement + carving. Pure geometry over the map's typed arrays; no
// entities, no Phaser. Rooms are non-overlapping axis-aligned rectangles with a
// one-tile wall gap between them (so no two rooms share a wall).

import { nextInt } from '../core/rng.js';
import { idx } from '../core/query.js';
import { TILE, MIN_ROOMS, MAX_ROOMS, MIN_ROOM_SIZE, MAX_ROOM_SIZE } from '../core/constants.js';

// Two rooms conflict if their rectangles come within one tile of each other.
function tooClose(a, b) {
  return a.x - 1 < b.x + b.w && a.x + a.w + 1 > b.x && a.y - 1 < b.y + b.h && a.y + a.h + 1 > b.y;
}

// Rejection-sample non-overlapping rooms. Returns an array of
// { id, x, y, w, h }. Guarantees at least 2 rooms so a far room exists for the
// stairs; typically MIN_ROOMS..MAX_ROOMS depending on how they pack.
export function placeRooms(rng, width, height) {
  const rooms = [];
  const maxAttempts = MAX_ROOMS * 30;
  for (let a = 0; a < maxAttempts && rooms.length < MAX_ROOMS; a++) {
    const w = nextInt(rng, MIN_ROOM_SIZE, MAX_ROOM_SIZE);
    const h = nextInt(rng, MIN_ROOM_SIZE, MAX_ROOM_SIZE);
    const x = nextInt(rng, 1, width - w - 1);
    const y = nextInt(rng, 1, height - h - 1);
    const candidate = { id: rooms.length, x, y, w, h };
    if (rooms.some((r) => tooClose(candidate, r))) continue;
    rooms.push(candidate);
    if (rooms.length >= MIN_ROOMS && nextInt(rng, 0, 3) === 0) {
      // Occasionally stop early once past the minimum, for varied densities.
      break;
    }
  }
  return rooms;
}

// Carve room interiors to FLOOR and stamp each floor tile with its room id.
export function carveRooms(map, rooms) {
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const i = idx(map, x, y);
        map.tiles[i] = TILE.FLOOR;
        map.roomAt[i] = room.id;
      }
    }
  }
}

export function roomCenter(room) {
  return { x: room.x + (room.w >> 1), y: room.y + (room.h >> 1) };
}

import { POTION_HEAL } from '../core/constants.js';

// Factory for a health potion at integer tile coordinates. Items live in
// state.items (they are not turn-taking entities). The id is assigned by the
// caller from the shared allocator so it is unique across the run.
export function createPotion(x, y) {
  return { id: 0, type: 'potion', x, y, heal: POTION_HEAL };
}

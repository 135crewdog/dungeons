// Small state mutators shared across the simulation: the entity id allocator,
// entity insertion, and the message log. Kept in a leaf module (imports nothing)
// so both gameState and the systems can use them without import cycles.

// Monotonically increasing entity ids define deterministic turn order.
export function allocId(state) {
  return state.entities.nextId++;
}

// Add an entity to the state, assigning it a fresh id. Returns the entity.
export function addEntity(state, entity) {
  entity.id = allocId(state);
  state.entities.byId.set(entity.id, entity);
  return entity;
}

// Append a structured message; the UI turns it into a display string. The log
// is capped so a long run does not grow it without bound.
const MAX_LOG = 100;
export function pushLog(state, type, data = {}) {
  state.log.push({ turn: state.turn, type, data });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

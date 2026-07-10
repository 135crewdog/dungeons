// Pointer → move-to commands. A mouse click and a finger tap are the same
// action (both are pointer events). Screen→tile conversion is injected so this
// module never imports the renderer. `toTile(clientX, clientY)` returns a tile
// or null.

export function attachPointer(target, toTile, dispatch) {
  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return; // primary / touch only
    const tile = toTile(e.clientX, e.clientY);
    if (!tile) return;
    e.preventDefault();
    dispatch({ type: 'moveTo', x: tile.x, y: tile.y });
  }
  target.addEventListener('pointerdown', onPointerDown);
  return () => target.removeEventListener('pointerdown', onPointerDown);
}

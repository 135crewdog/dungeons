// Two drawing strategies behind one interface, so the scene's hot loops
// (GlyphGrid.sync / syncItems / syncEntities) branch once — at painter
// selection — instead of per tile. A painter owns how a tile/entity/item is
// TEXTURED, TINTED and POSITIONED; the scene keeps ownership of layer
// membership and the visibility decisions that depend on game state.
//
// Phaser-free: painters operate on Images the scene creates via scene.add.image,
// so this module imports no Phaser. Selecting the painter (and recreating the
// Images under it via rebuildFloor) is the whole art-style switch.

import { TILE_SIZE } from '../core/constants.js';
import { tileToWorld } from './camera.js';
import { glyphKey } from './glyphLayer.js';
import {
  VIS,
  tileGlyph,
  tileColor,
  entityGlyph,
  entityColor,
  itemGlyph,
  itemColor,
  scaleColor,
} from './tileStyle.js';
import { tileSprite, entitySprite, itemSprite, REMEMBERED_TINT } from './spriteStyle.js';

// ASCII: white glyph textures + per-image tint (the original renderer, verbatim).
// Color carries identity, so remembered tiles/items dim by scaling the tint.
export function createAsciiPainter() {
  return {
    newTileImage(scene, wx, wy) {
      return scene.add.image(wx, wy, glyphKey('.')).setOrigin(0, 0).setVisible(false);
    },
    // The tile is known seen (VISIBLE or EXPLORED); hide the glyph-less ones.
    paintTile(img, tileType, vis) {
      const ch = tileGlyph(tileType);
      if (ch === ' ') {
        img.setVisible(false);
        return;
      }
      img.setTexture(glyphKey(ch));
      img.setTint(tileColor(tileType, vis));
      img.setVisible(true);
    },
    newEntityImage(scene) {
      return scene.add.image(0, 0, glyphKey('@')).setOrigin(0, 0);
    },
    paintEntity(img, e) {
      img.setTexture(glyphKey(entityGlyph(e)));
      img.setTint(entityColor(e));
      const w = tileToWorld(e.x, e.y);
      img.setPosition(w.x, w.y);
    },
    newItemImage(scene) {
      return scene.add.image(0, 0, glyphKey('!')).setOrigin(0, 0);
    },
    paintItem(img, item, lit) {
      img.setTexture(glyphKey(itemGlyph(item)));
      img.setTint(lit ? itemColor(item) : scaleColor(itemColor(item), 0.32));
      const w = tileToWorld(item.x, item.y);
      img.setPosition(w.x, w.y);
    },
  };
}

// Pixel: full-color SPD sprites. Identity comes from the texture, so tint is
// used ONLY to darken remembered tiles/items (to ~the ASCII dim). Tiles fill
// their 16x16 cell (origin top-left); actors sit on the tile floor, centered
// (origin bottom-center), so the 12x15 hero and the 16x16 mobs both align with
// no per-sprite offset.
export function createPixelPainter() {
  const actorX = (tx) => tx * TILE_SIZE + TILE_SIZE / 2;
  const actorY = (ty) => ty * TILE_SIZE + TILE_SIZE;
  return {
    newTileImage(scene, wx, wy) {
      return scene.add.image(wx, wy, 'spd:floor').setOrigin(0, 0).setVisible(false);
    },
    paintTile(img, tileType, vis) {
      const key = tileSprite(tileType);
      if (!key) {
        img.setVisible(false);
        return;
      }
      img.setTexture(key);
      if (vis === VIS.VISIBLE) img.clearTint();
      else img.setTint(REMEMBERED_TINT);
      img.setVisible(true);
    },
    newEntityImage(scene) {
      return scene.add.image(0, 0, 'spd:player').setOrigin(0.5, 1);
    },
    paintEntity(img, e, lit) {
      img.setTexture(entitySprite(e));
      if (lit) img.clearTint();
      else img.setTint(REMEMBERED_TINT);
      img.setPosition(actorX(e.x), actorY(e.y));
    },
    newItemImage(scene) {
      return scene.add.image(0, 0, 'spd:potion').setOrigin(0.5, 1);
    },
    paintItem(img, item, lit) {
      img.setTexture(itemSprite(item));
      if (lit) img.clearTint();
      else img.setTint(REMEMBERED_TINT);
      img.setPosition(actorX(item.x), actorY(item.y));
    },
  };
}

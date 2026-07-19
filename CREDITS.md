# Credits

## Tile and sprite art

The images under `public/assets/` are taken unmodified from
**Shattered Pixel Dungeon** by Evan Debenham ([00-Evan](https://github.com/00-Evan)),
which is based on **Pixel Dungeon** by Watabou (Oleg Dolya).

- Source repository: https://github.com/00-Evan/shattered-pixel-dungeon
- Pinned commit: `7b8b845a76fe76c6b7c031ae9e570852411f56db`
- Original paths: `core/src/main/assets/<path below>`

| Local file                     | Original path                  | SHA-256                                                            |
| ------------------------------ | ------------------------------ | ------------------------------------------------------------------ |
| `environment/tiles_prison.png` | `environment/tiles_prison.png` | `49a88feb6811b95b5c916e8f0f852bf1eadf2303e457f2ced80dcd3ef9fa1178` |
| `sprites/warrior.png`          | `sprites/warrior.png`          | `a8825d5f67bff1464f2bdffcf41590a39b087e21a113d811191d08a0323f71d3` |
| `sprites/gnoll.png`            | `sprites/gnoll.png`            | `1999a12b3c1482aeba208e1508d79199a8f98c3cc038e0bdcc9958c535e86706` |
| `sprites/skeleton.png`         | `sprites/skeleton.png`         | `93514c942af556d447dee6119b1f39317f88e24a669c52860f821ec2ab3e6159` |
| `sprites/tengu.png`            | `sprites/tengu.png`            | `a754b4ba9da4bfc8050df81e6745b2fe6ee7ace2729c3703ed38f772725c0949` |
| `sprites/items.png`            | `sprites/items.png`            | `ce2496368660e9b2c4b50401fe4436656cfab5f7785f667ef32aa6a294caacaf` |

Shattered Pixel Dungeon (code and assets) is licensed under the
**GNU General Public License v3.0** (or, at your option, any later version):
https://www.gnu.org/licenses/gpl-3.0.html

Accordingly, this project's distribution — which bundles that artwork — is made
available under GPL-compatible terms; the complete corresponding source for this
game is this repository. The wall/door autotiling scheme implemented in
`src/renderer/autotile.js` is a JavaScript reimplementation of the tile-stitching
logic described by Shattered Pixel Dungeon's `DungeonTileSheet`, and the entity/item
frame rectangles in `src/renderer/entitySprites.js` correspond to frames defined by
its sprite classes (`HeroSprite`, `GnollSprite`, `SkeletonSprite`, `TenguSprite`,
`ItemSpriteSheet`).

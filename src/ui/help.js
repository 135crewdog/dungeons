// Help overlay: who's who in the dungeon, what the stats do, and how to move.
// Entirely static content — it reads nothing and calls nothing back. Layered
// above the menu (z-index 30) like the leaderboard; Escape closes this layer
// only (the menu defers via isChildOpen).
//
// Six sections: Denizens / Loot / Rings / Dungeon legends, then Stats, Rules,
// and Controls tables.
//
// The legend is sprite-first: `iconFor(kind)` is injected by the composition
// root (the only place allowed to bridge renderer sprite data into the DOM)
// and returns an element cropping the real sheet — the same art the dungeon
// draws. Without the injection (tests, sheet failed to load) rows fall back
// to name-only text.

import { createOverlay } from './overlay.js';

// [icon kind, name, description]
const BESTIARY = [
  ['player', 'You', 'The armored dungeon crawler'],
  ['goblin', 'Goblin', 'A cackling snaggle-toothed fiend with a taste for flesh'],
  ['skeleton', 'Skeleton', 'A malevolent shambling pile of bones'],
  ['boss', 'Boss', 'A baleful unblinking eye that guards the way down every fifth floor'],
];

const LOOT = [
  ['potion', 'Potion', 'Health in a bottle — drink it by walking over it'],
  ['chest', 'Chest', 'Loot inside: strength, skill, armor, health… or a trap'],
  [
    'lockedChest',
    'Locked chest',
    'Holds a magic ring; its key hides somewhere on an earlier floor',
  ],
  ['key', 'Key', 'Hidden until you pass close by — it glints. Opens a locked chest'],
];

const RINGS = [
  ['ring:sight', 'Ring of Sight', 'The whole floor lies revealed before you'],
  [
    'ring:shadow',
    'Ring of Shadow',
    'Enemies lose you — unless you fight near them, crowd them, or face a boss',
  ],
  ['ring:speed', 'Ring of Speed', 'Two steps a turn; attacks still end the turn'],
  ['ring:survival', 'Ring of Survival', 'Cheats death once, then crumbles to dust'],
];

const DUNGEON = [
  ['stairsDown', 'Stairs down', 'The only way is deeper'],
  ['stairsUp', 'Stairs up', 'For going back the way you came'],
  ['door', 'Door', 'Nobody sees through it until they stand in it'],
  ['wall', 'Wall', 'Famously impassable'],
  ['floor', 'Floor', 'Walk here'],
];

const STATS = [
  ['HP', 'Health points, how much more damage you can sustain'],
  ['Floor', 'Dungeon floor, starts on 1, goes deeper and deeper'],
  ['STR', 'Strength, increases how much damage you deal to enemies'],
  ['ARM', 'Armor, reduces the damage enemies deal to you'],
  ['SKL', 'Skill, improves your hit or miss accuracy'],
  ['KEY', 'Secret keys in hand — any key opens any locked chest'],
];

const CONTROLS = [
  ['Arrows / WASD', 'Move one tile — up, down, left or right only'],
  ['Numpad 1–4, 6–9', 'Move in all 8 directions, diagonals included'],
  ['Click / tap', 'Auto-walk there, one tile per turn'],
  ['Click an enemy', 'Close in and take a single swing'],
  ['Escape', 'Open or close the menu'],
  ['Menu → End run', 'Stop here on purpose and post your score'],
];

// The rules a player can otherwise only learn by being surprised by them. Kept
// as its own table rather than swelling the legend rows, and deliberately
// without the tuned numbers (radii, spawn weights) — how a thing behaves is
// the player's business, how it is balanced is not.
const RULES = [
  ['Turns', 'Every move, attack or stair step is one turn. Blocked moves are free'],
  ['Attacking', 'Step into an enemy to hit it. A d20 roll decides; a natural 1 always misses'],
  ['Damage', 'Your die plus strength, less their armor — a hit always does at least 1'],
  ['Diagonals', 'Numpad only. You cannot cut a wall corner, and neither can they'],
  ['Auto-walk', 'Routes around staircases, so you never change floor by accident'],
  ['Stairs', 'Stepping on them changes floor at once. Floors keep their state — go back up'],
  ['Ring of Speed', 'The second step is given up if you land on loot or on stairs'],
  ['Ring of Shadow', 'Swinging is heard through walls, hit or miss. Bosses always see you'],
  ['Keys', 'Any key opens any locked chest — a key you skipped is not lost forever'],
];

// A legend table: [icon] Name | description per row. The icon cell is omitted
// entirely when no icon factory is available.
function legendTable(rows, iconFor) {
  const t = document.createElement('table');
  t.className = 'help-table';
  for (const [kind, name, text] of rows) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.className = 'help-key';
    const icon = iconFor ? iconFor(kind) : null;
    if (icon) {
      icon.classList.add('help-icon');
      td1.appendChild(icon);
    }
    td1.appendChild(document.createTextNode(name));
    const td2 = document.createElement('td');
    td2.textContent = text;
    tr.append(td1, td2);
    t.appendChild(tr);
  }
  return t;
}

function table(rows, keyClass) {
  const t = document.createElement('table');
  t.className = 'help-table';
  for (const [key, text] of rows) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.className = keyClass;
    td1.textContent = key;
    const td2 = document.createElement('td');
    td2.textContent = text;
    tr.append(td1, td2);
    t.appendChild(tr);
  }
  return t;
}

function label(text) {
  const div = document.createElement('div');
  div.className = 'panel-label';
  div.textContent = text;
  return div;
}

export function createHelp(parent, { iconFor = null } = {}) {
  const { el, panel, isOpen, show, hide } = createOverlay({
    id: 'help',
    title: 'Help',
    ariaLabel: 'Help',
    panelClass: 'help-panel',
    onClose: () => hide(),
  });
  panel.append(
    label('Denizens'),
    legendTable(BESTIARY, iconFor),
    label('Loot'),
    legendTable(LOOT, iconFor),
    label('Rings'),
    legendTable(RINGS, iconFor),
    label('Dungeon'),
    legendTable(DUNGEON, iconFor),
    label('Stats'),
    table(STATS, 'help-key'),
    label('Rules'),
    table(RULES, 'help-key'),
    label('Controls'),
    table(CONTROLS, 'help-key'),
  );
  parent.appendChild(el);

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.preventDefault();
    hide();
  });

  return { open: show, close: hide, isOpen, el };
}

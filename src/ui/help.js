// Help overlay: what the glyphs mean, what the stats do, and how to move.
// Entirely static content — it reads nothing and calls nothing back. Layered
// above the menu (z-index 30) like the leaderboard; Escape closes this layer
// only (the menu defers via isChildOpen).

import { createOverlay } from './overlay.js';

// The keys are the classic roguelike notation (and the ASCII-mode look);
// in the dungeon these now wear their sprite art.
const GLYPHS = [
  ['@', 'You, the armored dungeon crawler'],
  ['g', 'Goblin, a cackling snaggle-toothed fiend with a taste for flesh'],
  ['s', 'Skeleton, a malevolent shambling pile of bones'],
  ['B', 'Boss, a baleful unblinking eye that guards the way down every fifth floor'],
  ['!', 'Health potion, drink this if you want to live'],
  ['$', 'Treasure chest, look inside to grab some loot, might also be a trap'],
  ['>', 'Stairs down, the only way is deeper'],
  ['<', 'Stairs up, for going back the way you came'],
  ['+', 'Door, nobody sees through it until they stand in it'],
  ['#', 'Wall, famously impassable'],
  ['.', 'Floor, walk here'],
];

const STATS = [
  ['HP', 'Health points, how much more damage you can sustain'],
  ['Floor', 'Dungeon floor, starts on 1, goes deeper and deeper'],
  ['STR', 'Strength, increases how much damage you deal to enemies'],
  ['ARM', 'Armor, reduces the damage enemies deal to you'],
  ['SKL', 'Skill, improves your hit or miss accuracy'],
];

const CONTROLS = [
  ['Arrows / WASD', 'Move one tile (up, down, left, right)'],
  ['Numpad 1–9', 'Move in all 8 directions, diagonals included'],
  ['Click / tap', 'Auto-walk there, one tile per turn'],
  ['Escape', 'Open or close the menu'],
];

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

export function createHelp(parent) {
  const { el, panel, isOpen, show, hide } = createOverlay({
    id: 'help',
    title: 'Help',
    ariaLabel: 'Help',
    panelClass: 'help-panel',
    onClose: () => hide(),
  });
  panel.append(
    label('Symbols'),
    table(GLYPHS, 'help-key help-glyph'),
    label('Stats'),
    table(STATS, 'help-key'),
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

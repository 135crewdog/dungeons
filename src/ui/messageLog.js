// Message log overlay: a few lines of recent events, anchored to the bottom.
// It formats the simulation's structured log entries into readable text. Read
// only; never mutates state.
//
// Lines are built as elements with textContent, never interpolated into an
// HTML string — the formatted text embeds log data (enemy names, ring names),
// so markup rendering here would be a live injection point the moment any of
// that data stops being internal.

const MAX_LINES = 6;

function format(entry) {
  const d = entry.data || {};
  switch (entry.type) {
    case 'hit':
      return d.attacker === 'player'
        ? `You hit the ${d.target} for ${d.damage}.`
        : `The ${d.attacker} hits you for ${d.damage}.`;
    case 'miss':
      return d.attacker === 'player'
        ? `You miss the ${d.target}.`
        : `The ${d.attacker} misses you.`;
    case 'death':
      return d.kind === 'player' ? 'You die...' : `The ${d.kind} dies.`;
    case 'pickup':
      if (d.item === 'chest') {
        switch (d.effect) {
          case 'strength':
            return `You open a chest: +${d.amount} Strength.`;
          case 'skill':
            return `You open a chest: +${d.amount} Skill.`;
          case 'armor':
            return `You open a chest: +${d.amount} Armor.`;
          case 'health':
            return `You open a chest: +${d.amount} max HP, fully restored.`;
          case 'trap':
            return `You open a chest: a trap hits you for ${d.amount}!`;
          default:
            return 'You open a chest.';
        }
      }
      if (d.item === 'key') return 'You pick up a golden key.';
      if (d.item === 'ring') return `You slip on the ${ringName(d.ring)}.`;
      return `You drink a potion (+${d.heal} HP).`;
    case 'reveal':
      return 'A glimmer catches your eye.';
    case 'locked':
      return 'The chest is locked — you need a key.';
    case 'unlock':
      return 'You unlock the chest — a ring tumbles out!';
    case 'survival':
      return 'Your ring flares and crumbles to dust — you feel life surge back!';
    case 'descend':
      return `You descend to floor ${d.floor}.`;
    case 'ascend':
      return `You ascend to floor ${d.floor}.`;
    default:
      return '';
  }
}

// 'sight' → 'Ring of Sight' (shared vocabulary with the HUD chips).
export function ringName(ring) {
  const cap = typeof ring === 'string' && ring ? ring[0].toUpperCase() + ring.slice(1) : '?';
  return `Ring of ${cap}`;
}

export function createMessageLog(parent) {
  const el = document.createElement('div');
  el.id = 'msglog';
  el.className = 'overlay';
  parent.appendChild(el);

  function update(state) {
    const recent = state.log.slice(-MAX_LINES);
    const n = recent.length;
    const lines = [];
    recent.forEach((entry, i) => {
      const text = format(entry);
      if (!text) return;
      const line = document.createElement('div');
      line.className = 'line';
      // Older lines fade out toward the top.
      line.style.opacity = (0.4 + 0.6 * ((i + 1) / n)).toFixed(2);
      line.textContent = text;
      lines.push(line);
    });
    el.replaceChildren(...lines);
  }

  return { update, el };
}

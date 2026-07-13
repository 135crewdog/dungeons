// Message log overlay: a few lines of recent events, anchored to the bottom.
// It formats the simulation's structured log entries into readable text. Read
// only; never mutates state.

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
      return `You drink a potion (+${d.heal} HP).`;
    case 'descend':
      return `You descend to floor ${d.floor}.`;
    case 'ascend':
      return `You ascend to floor ${d.floor}.`;
    default:
      return '';
  }
}

export function createMessageLog(parent) {
  const el = document.createElement('div');
  el.id = 'msglog';
  el.className = 'overlay';
  parent.appendChild(el);

  function update(state) {
    const recent = state.log.slice(-MAX_LINES);
    const n = recent.length;
    el.innerHTML = recent
      .map((entry, i) => {
        const text = format(entry);
        if (!text) return '';
        // Older lines fade out toward the top.
        const opacity = 0.4 + 0.6 * ((i + 1) / n);
        return `<div class="line" style="opacity:${opacity.toFixed(2)}">${text}</div>`;
      })
      .join('');
  }

  return { update, el };
}

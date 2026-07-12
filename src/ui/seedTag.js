// Seed chip overlay: shows the current run's seed and copies it to the clipboard
// on click, so a run can be reproduced (reopen with ?seed=<value>) or shared. A
// DOM overlay like the HUD — it only reads state, never mutates it. Anchored to
// the top-right corner, opposite the top-left HP/floor HUD.

export function createSeedTag(parent) {
  const el = document.createElement('div');
  el.id = 'seedtag';
  el.className = 'overlay';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'seed-btn';
  btn.title = 'Copy seed to clipboard';
  el.appendChild(btn);
  parent.appendChild(el);

  let seed = null;
  let flashTimer = null;

  const showSeed = () => {
    btn.textContent = `seed ${seed}`;
  };

  async function copy() {
    if (seed == null) return;
    const ok = await writeClipboard(String(seed));
    btn.textContent = ok ? 'copied ✓' : `seed ${seed}`;
    if (flashTimer) clearTimeout(flashTimer);
    if (ok) flashTimer = setTimeout(showSeed, 1200);
  }
  btn.addEventListener('click', copy);

  // Refresh the displayed seed. Only the seed changes across a run (on restart);
  // descending/ascending keeps it, so this is cheap and idempotent.
  function update(state) {
    if (state.seed === seed) return;
    seed = state.seed;
    if (flashTimer) {
      clearTimeout(flashTimer);
      flashTimer = null;
    }
    showSeed();
  }

  return { update, el };
}

// Copy text to the clipboard, returning whether it succeeded. Uses the async
// Clipboard API in secure contexts and falls back to a hidden textarea +
// execCommand for older or non-secure ones.
async function writeClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

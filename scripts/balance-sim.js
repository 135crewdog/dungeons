// CLI for the headless balance simulator: seeds N bot-driven runs through the
// real simulation and prints the survival curve the balance targets are tuned
// against (CLAUDE.md: floor 1 kills careless players sometimes, ~2/3 of
// thorough players clear floor 10, stair-rushers rarely do).
//
//   npm run balance -- --runs 300 --seed 1000 --max-floor 12 --policy both
//   npm run balance -- --json          # machine-readable, for before/after diffs
//
// Everything routes through the game's own mulberry32 RNG (seeds are
// baseSeed..baseSeed+runs-1), so a report is exactly reproducible.

import { runBatch } from './balance/runner.js';

function parseArgs(argv) {
  const opts = { runs: 200, seed: 1000, maxFloor: 12, policy: 'both', json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs') opts.runs = Number(argv[++i]);
    else if (arg === '--seed') opts.seed = Number(argv[++i]);
    else if (arg === '--max-floor') opts.maxFloor = Number(argv[++i]);
    else if (arg === '--policy') opts.policy = argv[++i];
    else if (arg === '--json') opts.json = true;
    else {
      console.error(`unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

function pct(x) {
  return `${Math.round(x * 100)}%`;
}

function printReport(batch) {
  const { policy, runs, baseSeed, maxFloor, summary } = batch;
  console.log(`\n=== ${policy} — ${runs} runs, seeds ${baseSeed}..${baseSeed + runs - 1}, floors 1..${maxFloor} ===`);

  const floors = Array.from({ length: maxFloor }, (_, i) => i + 1);
  const rows = [
    ['floor', ...floors.map(String)],
    ['reached', ...floors.map((f) => pct(summary.reachedByFloor[f]))],
    ['died here', ...floors.map((f) => String(summary.deathsByFloor[f] ?? 0))],
    ['hp on descent', ...floors.map((f) => {
      const d = summary.avgAtDescent[f];
      return d ? `${d.hp.toFixed(1)}/${d.maxHp.toFixed(1)}` : '-';
    })],
    ['str/arm on descent', ...floors.map((f) => {
      const d = summary.avgAtDescent[f];
      return d ? `${d.strength.toFixed(1)}/${d.armor.toFixed(1)}` : '-';
    })],
  ];
  printTable(rows);

  const clear10 = summary.reachedByFloor[Math.min(11, maxFloor + 1)];
  console.log(`cleared floor 10 (reached 11): ${pct(clear10)}   cleared all ${maxFloor}: ${pct(summary.cleared)}`);
  console.log(`median death floor: ${summary.medianDeathFloor ?? '-'}   boss-floor death share: ${pct(summary.bossFloorDeathShare)}`);
  const causes = Object.entries(summary.deathCauses)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  console.log(`death causes: ${causes || 'none'}   avg turns/run: ${summary.avgTurns.toFixed(0)}`);
  if (summary.stalled > 0) {
    console.log(`WARNING: ${summary.stalled} stalled runs — bot bug, results are suspect`);
  }
}

function printTable(rows) {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => r[col].length)));
  for (const row of rows) {
    console.log(row.map((cell, col) => cell.padStart(widths[col])).join('  '));
  }
}

const opts = parseArgs(process.argv.slice(2));
const policies = opts.policy === 'both' ? ['thorough', 'rusher'] : [opts.policy];
const batches = policies.map((p) =>
  runBatch(p, { runs: opts.runs, baseSeed: opts.seed, maxFloor: opts.maxFloor }),
);

if (opts.json) {
  console.log(
    JSON.stringify(
      batches.map(({ results, ...rest }) => rest),
      null,
      2,
    ),
  );
} else {
  for (const batch of batches) printReport(batch);
}

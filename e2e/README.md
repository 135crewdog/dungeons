# End-to-end tests

A real-browser campaign that drives the built PWA with Playwright and checks the
things unit tests can't: rendering, input→sim→renderer round-trips, floor
persistence, overlay layering, the death/leaderboard flow, and PWA offline boot.
It is **not** part of `npm test` (it needs a browser and a built app) — run it on
demand.

## Running

```bash
npm run build        # the campaign drives the preview build, not dev
npm run test:e2e     # spawns `vite preview` on :4173, runs, tears down
```

`test:e2e` starts (and stops) the preview server itself. If port 4173 is already
serving the build, it reuses it.

### Browser

Playwright's own Chromium isn't downloaded (`playwright-core` only). The runner
defaults to the Chromium that ships in the Claude Code container
(`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). Elsewhere, point it at a
Chromium/Chrome binary:

```bash
CHROMIUM_PATH=/path/to/chrome npm run test:e2e
```

## What it guards

16 scenarios: boot + version + seed/URL parity, keyboard movement + wall bump +
key-repeat, bump combat (plain-language log), click auto-walk + cancellation,
descend/return **floor persistence**, door-occluded FOV, the pause menu
(pause-gating, seed copy/load, restart-same-seed), overlay layering + Escape
ordering + XSS-safe rows, the death → initials → one-submission-lock → restart
flow, a **188-command sim/browser parity** replay (the architecture keystone),
resize/integer-scaling at three DPRs, and PWA manifest/SW/offline reload.

### Production-leaderboard safety

Every browser context runs three guards so nothing reaches the real leaderboard:
a catch-all route that aborts anything off-origin (with an `escaped[]` tripwire),
a stub for the leaderboard origin (GET → fixture rows, POST → captured + fake
201), and service workers blocked in game contexts. The teardown asserts zero
escaped requests.

## Fixtures

`fixtures.json` holds deterministic seeds and pre-simulated command streams so
each browser replay can be checked against the headless engine's prediction.
Regenerate them (e.g. after a gameplay change) with:

```bash
node e2e/discover.mjs
```

Artifacts (screenshots, results.json) are written to `e2e/.artifacts/`, which is
git-ignored.

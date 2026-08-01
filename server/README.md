# Leaderboard server (Cloudflare Worker + D1)

A tiny worker that stores and serves the cross-device leaderboard: 30-day
rolling window, top 50, ranked by floor (desc), then turns (asc), then
submission time. The game client talks to it via `src/net/leaderboard.js`.

- `worker.js` — the Worker: `GET /scores`, `POST /scores`, CORS, rate limit.
- `scores.js` — pure validation/SQL logic (unit-tested in `tests/`).
- `worker.dashboard.js` — the same Worker inlined into one import-free file for
  pasting into the Cloudflare dashboard editor (the no-install path below).
- `schema.sql` — the one-table D1 schema.
- `wrangler.toml` — Worker + D1 binding config.

## Deploy from the browser — no install (Cloudflare dashboard)

Prefer clicking to typing, or don't want to install anything? Do it all at
[dash.cloudflare.com](https://dash.cloudflare.com):

1. **D1 → Create database** named `dungeons-leaderboard`. Open its **Console**
   tab, paste the contents of `schema.sql`, and run it.
2. **Workers → Create Worker** (start from Hello World), name it, Deploy, then
   **Edit code**: replace the sample with all of `worker.dashboard.js` and Deploy.
3. In the Worker's **Settings → Bindings**, add a **D1 database** binding named
   exactly `DB`, pointing at `dungeons-leaderboard`, and Deploy once more.
4. In the same **Settings**, add an environment **Variable** named
   `ALLOWED_ORIGIN` with the value `*`, and Deploy again. **This one is not
   optional**: the Worker treats a missing `ALLOWED_ORIGIN` as a
   misconfiguration and answers with no CORS headers at all, so the game
   would be unable to read any response. (`*` is fine — the API uses no
   cookies or credentials. To restrict it later, use a comma-separated list of
   origins, e.g. `https://you.github.io,http://localhost:5173`.)
5. Copy the Worker's `*.workers.dev` URL into `LEADERBOARD_URL` in
   `src/net/config.js` and commit.

## One-time deploy (wrangler CLI)

Requires a free Cloudflare account. From this `server/` directory:

```sh
npx wrangler login
npx wrangler d1 create dungeons-leaderboard
```

Copy the printed `database_id` into `wrangler.toml`, then:

```sh
npx wrangler d1 execute dungeons-leaderboard --remote --file=./schema.sql
npx wrangler deploy
```

`deploy` prints the worker URL, e.g.
`https://dungeons-leaderboard.<account>.workers.dev`. Paste it into
`LEADERBOARD_URL` in `src/net/config.js` and commit. That's it — until then
the game runs normally with the leaderboard showing "not configured".

## Updating an already-deployed worker

Worker changes are **not** picked up by the game's GitHub Pages deploy — that
workflow only publishes `dist/`. The backend is deployed by hand, and **this
project's worker was set up through the dashboard**, not the CLI (which is why
`wrangler.toml` still carries the `database_id` placeholder). Update it the same
way you created it.

### Do these in order — the order is what makes it safe

**1. Set `ALLOWED_ORIGIN` first, before touching the code.** Since v0.9.5 a
missing value means _unconfigured_: the worker sends no CORS headers at all, so
the browser discards a reply that looks perfectly fine server-side. Pre-0.9.5
code read `env.ALLOWED_ORIGIN || '*'`, so adding the variable to a worker still
running the old code changes nothing — which is exactly why it goes first. Do it
and the new code lands already configured, with no window where the board is dark.

In the worker's **Settings → Variables and Secrets**, add `ALLOWED_ORIGIN` = `*`
and save. `*` is fine — the API uses no cookies or credentials. Narrow it later
to a comma-separated origin list if you want, e.g.
`https://example.github.io,http://localhost:5173`.

**2. Run the schema.** D1 → `dungeons-leaderboard` → **Console** → paste all of
`schema.sql` → Run. Every statement is `CREATE ... IF NOT EXISTS`, so it cannot
disturb existing rows; it adds `idx_scores_dupe`, which backs the duplicate check
the worker runs before every insert. Without the index the check still works, it
just scans.

**3. Paste the code.** Worker → **Edit Code** → replace everything with
`worker.dashboard.js` → Deploy. That file is committed and CI fails if it drifts
from `scores.js` + `worker.js`, so copy it as-is; `npm run build:dashboard` is
only needed if you edited `server/*.js` yourself.

**4. Check it.** `curl -si <worker-url>/scores | grep -i access-control-allow-origin`
should print a line containing `*` — nothing means step 1 didn't take. Then POST
the same score twice: `201` then `409` confirms duplicate suppression is live.

### With wrangler instead

`wrangler.toml` supplies the binding and the variable automatically, so it is
just the two commands — but fill in `database_id` first (see the CLI section
above; `npx wrangler d1 list` prints it for an existing database):

```sh
# 1. new indexes / schema (idempotent, safe to re-run on a live database)
npx wrangler d1 execute dungeons-leaderboard --remote --file=./schema.sql
# 2. the worker itself
npx wrangler deploy
```

## Local development

```sh
npx wrangler d1 execute dungeons-leaderboard --local --file=./schema.sql
npx wrangler dev
```

Serves on `http://127.0.0.1:8787` against a local D1. Smoke test:

```sh
curl -X POST 127.0.0.1:8787/scores -H 'content-type: application/json' \
  -d '{"initials":"abc","floor":7,"version":"0.5.0","seed":"123","turns":420}'
curl 127.0.0.1:8787/scores
```

To point the game at it, temporarily set `LEADERBOARD_URL` in
`src/net/config.js` to `http://127.0.0.1:8787` (revert before committing).

## API

- `GET /scores` → `200 { scores: [{ initials, floor, turns, version, created_at }...], now }`
  — `now` is the server clock (unix ms) so clients can render ages without
  trusting the device clock.
- `POST /scores` with `{ initials, floor, turns, seed, version }` →
  `201 { ok: true }`, or `400` (invalid JSON or a field that fails validation),
  `409` (an identical `initials`/`floor`/`turns`/`seed` within 10 minutes — the
  offline queue re-sending a score whose response was lost), `413` (body > 512
  bytes, measured in real UTF-8 bytes and also checked against `Content-Length`
  before the body is read), `415` (content type is not JSON), `429` (> 6
  posts/min/IP, best-effort per isolate, with `Retry-After`).
- Any other method on `/scores` → `405`; any other path → `404`; a D1 failure on
  either route → `500 { error: 'storage unavailable' }` with `no-store`.
- `OPTIONS` → `204`. CORS **fails closed**: with `ALLOWED_ORIGIN` unset, every
  response above carries no CORS headers at all and browsers discard it.

Anti-cheat is honor-level: the payload carries the seed, so a suspicious run
could later be replay-verified with the headless engine, but nothing enforces
that today.

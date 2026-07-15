# Leaderboard server (Cloudflare Worker + D1)

A tiny worker that stores and serves the cross-device leaderboard: 30-day
rolling window, top 50, ranked by floor (desc), then turns (asc), then
submission time. The game client talks to it via `src/net/leaderboard.js`.

- `worker.js` — the Worker: `GET /scores`, `POST /scores`, CORS, rate limit.
- `scores.js` — pure validation/SQL logic (unit-tested in `tests/`).
- `worker.dashboard.js` — an optional, manually maintained import-free copy for
  the Cloudflare dashboard editor. It is not covered directly by the test suite;
  `worker.js` and `scores.js` remain the source of truth.
- `schema.sql` — the one-table D1 schema.
- `wrangler.toml` — Worker + D1 binding config.

## Deploy from the browser — no install (Cloudflare dashboard)

Prefer clicking to typing, or don't want to install anything? Do it all at
[dash.cloudflare.com](https://dash.cloudflare.com):

1. **D1 → Create database** named `dungeons-leaderboard`. Open its **Console**
   tab, paste the contents of `schema.sql`, and run it.
2. **Workers → Create Worker** (start from Hello World), name it, and create it.
   Under **Edit code**, replace the sample with all of `worker.dashboard.js`.
3. In the Worker's **Settings → Bindings**, add a **D1 database** binding named
   exactly `DB`, pointing at `dungeons-leaderboard`, then deploy the Worker.
4. Copy the Worker's `*.workers.dev` URL into `LEADERBOARD_URL` in
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

- `GET /scores` → `200 { scores: [{ initials, floor, turns, version, created_at }, …], now }`
  — `now` is the server clock (unix ms) so clients can render ages without
  trusting the device clock.
- `POST /scores` with `{ initials, floor, turns, seed, version }` →
  `201 { ok: true }`, or `400` (invalid), `413` (body > 512 bytes),
  `429` (> 6 posts/min/IP, best-effort per isolate).

Anti-cheat is honor-level: the payload carries the seed, so a suspicious run
could later be replay-verified with the headless engine, but nothing enforces
that today.

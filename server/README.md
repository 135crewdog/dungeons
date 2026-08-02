# Leaderboard server (Cloudflare Worker + D1)

A tiny worker that stores and serves the cross-device leaderboard: 30-day
rolling window, top 50, ranked by floor (desc), then turns (asc), then
submission time. The game client talks to it via `src/net/leaderboard.js`.

- `worker.js` — the Worker: `GET /scores`, `POST /scores`, `GET /health`, CORS,
  rate limit.
- `scores.js` — pure validation/SQL logic (unit-tested in `tests/`).
- `worker.dashboard.js` — the same Worker inlined into one import-free file for
  pasting into the Cloudflare dashboard editor (the no-install path below).
- `schema.sql` — the one-table D1 schema.
- `../wrangler.toml` — Worker + D1 binding config. It lives at the **repository
  root**, not here, because Cloudflare Workers Builds only looks for it there;
  see "Why the config is a directory up" below. It is the only copy.

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

Requires a free Cloudflare account. Run these from the **repository root** (that
is where `wrangler.toml` is):

```sh
npx wrangler login
npx wrangler d1 create dungeons-leaderboard
```

Copy the printed `database_id` into `wrangler.toml`, then:

```sh
npx wrangler d1 execute dungeons-leaderboard --remote --file=./server/schema.sql
npx wrangler deploy
```

`deploy` prints the worker URL, e.g.
`https://dungeons-leaderboard.<account>.workers.dev`. Paste it into
`LEADERBOARD_URL` in `src/net/config.js` and commit. That's it — until then
the game runs normally with the leaderboard showing "not configured".

## Updating an already-deployed worker

The worker is **connected to this GitHub repository** (Cloudflare Workers
Builds), so a change under `server/` that lands on `main` deploys itself. That
connection is the fix for the failure mode that produced issue #30: the game and
the backend deploy from the same push instead of the backend waiting on somebody
to remember it. The game's own workflow still only publishes `dist/` — it is
Cloudflare, not GitHub Actions, that ships the worker.

### Why the config is a directory up

`wrangler.toml` is at the **repository root** even though everything it describes
is in here. Workers Builds looks for a Wrangler config in the build's **root
directory** — which defaults to the repository root — and **rejects the build
before it starts** when it finds none.

That is what four consecutive failed builds were, and moving the file fixed it on
the first try: `7b6cd46` is the first build that ran (~15 minutes, most of it
installing the game's dev dependencies) and the first that deployed.

**Do not try to diagnose this from the GitHub check run's timestamps.** The
failed builds all reported the same second for start and finish, which looks like
"rejected before it started" — but the _successful_ builds report the same second
too (`bd35efb`: `20:45:49` → `20:45:49`, for a build that took a quarter of an
hour). Cloudflare stamps both fields when it updates the check, so they carry no
duration information at all and cannot distinguish a rejection from a run. The
PR comment the bot edits in place does show real progress (`In progress` →
`Deployment successful`); the check run does not.

Keeping the config where the tooling already looks means the deploy works on
Cloudflare's **default** settings — no root directory to set, no deploy command
to override, nothing for the next person to rediscover. `main =
"server/worker.js"` points back at the code, and wrangler bundles that entry with
its `./scores.js` import as usual.

**Do not add a second `wrangler.toml` under `server/`.** Two copies would drift,
and the one that loses is whichever a deploy doesn't read — the same reason
`worker.dashboard.js` is generated and byte-checked rather than maintained by
hand.

If someone has since set **Root directory** to `server` in the dashboard (Workers
& Pages → dungeons-leaderboard → Settings → Build), put it back to blank — with
this layout the default is correct.

### The one rule that will bite you

**A deploy makes the live worker match `wrangler.toml`, replacing whatever is
configured in the dashboard** — both `[vars]` and bindings. So:

- `database_id` must be the real id of the live D1 database. A wrong or
  placeholder value silently detaches the worker from its data and every request
  returns `500 {"error":"storage unavailable"}`.
- Setting `ALLOWED_ORIGIN` by hand in the dashboard is redundant: the value in
  this file wins on the next deploy. Change it here, not there.
- `workers_dev = true` is stated explicitly rather than left to the default. The
  game reaches the worker at its `*.workers.dev` address (`LEADERBOARD_URL` in
  `src/net/config.js`), so that URL is not a convenience — an unstated value that
  ever resolved to `false` would switch it off and take the leaderboard with it.

All three are correct in the committed file. Editing bindings or vars in the
dashboard is the thing to avoid — those edits are lost on the next push.

### Schema changes are NOT automatic — and they must go FIRST

A build pipeline ships code; it does not run migrations. `schema.sql` is applied
by hand: D1 → `dungeons-leaderboard` → **Console** → run it.

**Order matters, and the Git deploy makes it easy to get wrong.** Code now ships
the moment a change lands on `main`, so merging a worker that depends on a new
table or column _before_ applying the migration deploys code against a schema
that does not exist yet — a live failure window that lasts until somebody
notices. The old by-hand checklist ran the schema first because both steps were
manual and adjacent; now only one of them is. So:

- **Apply the migration BEFORE merging** code that depends on it, or
- make the change **backward compatible** — a worker that tolerates both the old
  and new shape can ship in either order, and the schema catches up after.

`CREATE ... IF NOT EXISTS` throughout means re-running the file is always safe,
so applying it early costs nothing.

**The console will not always take the file verbatim.** It reports

> The request is malformed: Requests without any query are not supported.

when what it receives contains no executable statement — which a comment block,
or the empty fragment after the file's trailing `;`, can produce. Strip the
comments and paste the statements, one at a time if it still objects:

```sh
grep -v '^\s*--' schema.sql
```

`schema.sql` is the **only** authoritative copy; do not transcribe it into prose
here, or the two drift and an operator runs the stale one.

The exception, because it is a one-off rather than a description of the schema:
bringing a database created before v0.9.5 up to date is exactly one statement,
since the table and `idx_scores_created` already exist.

```sql
CREATE INDEX IF NOT EXISTS idx_scores_dupe ON scores (seed, initials, floor, turns, created_at);
```

### Checking a deploy landed

Ask the worker directly. `GET /health` is unauthenticated, writes nothing, and
is never edge-cached:

```sh
curl -s <worker-url>/health
```

```json
{ "ok": true, "version": "…", "deployedAt": "…", "db": "ok", "rows": 128 }
```

- **`version` / `deployedAt`** come from Cloudflare's version-metadata binding
  and identify the exact deployment. Compare `deployedAt` against the build you
  expect to be live; if it predates your merge, the deploy did not land, whatever
  the build log says. `null` for both means the `[version_metadata]` block in
  `wrangler.toml` did not survive the deploy — the code is old.
- **`db: "ok"`** means the D1 binding is attached and the `scores` table exists.
  A `500 storage unavailable` here means it is not — the probe is the same query
  path the real endpoints use.
- **`rows`** is the total row count. This is the only field that distinguishes a
  worker bound to the RIGHT database from one bound to a different database with
  the same schema — sanity-check it against what the in-game board shows. Nothing
  else in the API can tell those apart.

CORS is worth checking separately, since it is configuration rather than code:

```sh
curl -si <worker-url>/scores | grep -i access-control-allow-origin
```

should print a line containing `*`. Nothing means `ALLOWED_ORIGIN` is unset —
CORS fails closed by design, so the browser sees no headers at all.

Note what `/health` still cannot tell you: `storageError` normalizes every D1
exception into one response, so a missing table, a half-applied migration and a
transient outage all read as `500 storage unavailable`. Check the binding in
`wrangler.toml` against `npx wrangler d1 list` before assuming which it is.

The old probe — POST the same score twice and look for `201` then `409` — still
works and still proves the code is v0.9.5+, but prefer `/health`: it is exact
rather than inferential, and it does not leave a junk score on the board.

### Fallbacks, if the Git deploy is unavailable

**By hand in the dashboard.** Worker → **Edit Code** → replace everything with
`worker.dashboard.js` → Deploy. That file is committed and CI fails if it drifts
from `scores.js` + `worker.js`, so copy it as-is; `npm run build:dashboard` is
only needed if you edited `server/*.js` yourself. Note this route does **not**
apply `wrangler.toml`, so bindings and vars must already be right in the
dashboard.

**With wrangler.** `wrangler.toml` supplies the binding and the variable, so from
the **repository root** it is just:

```sh
# 1. new indexes / schema (idempotent, safe to re-run on a live database)
npx wrangler d1 execute dungeons-leaderboard --remote --file=./server/schema.sql
# 2. the worker itself
npx wrangler deploy
```

## Local development

From the **repository root**:

```sh
npx wrangler d1 execute dungeons-leaderboard --local --file=./server/schema.sql
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
  posts/min/IP, best-effort per isolate, with `Retry-After`). A body that cannot
  be read at all — aborted upload, truncated stream — is `400`, not a crash.
- `GET /health` → `200 { ok, version, deployedAt, db, rows }` with `no-store`.
  Identifies the live deployment and proves the D1 binding works; `rows` is what
  distinguishes the right database from a schema-compatible wrong one. No
  authentication, and nothing here is secret. See "Checking a deploy landed".
- Any other method on `/scores` → `405`; any other path → `404`; a D1 failure on
  either route → `500 { error: 'storage unavailable' }` with `no-store`.
- `OPTIONS` → `204`. CORS **fails closed**: with `ALLOWED_ORIGIN` unset, every
  response above carries no CORS headers at all and browsers discard it.

Anti-cheat is honor-level: the payload carries the seed, so a suspicious run
could later be replay-verified with the headless engine, but nothing enforces
that today.

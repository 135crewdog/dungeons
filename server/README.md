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

The worker is **connected to this GitHub repository** (Cloudflare Workers
Builds), so a change under `server/` that lands on `main` deploys itself. That
connection is the fix for the failure mode that produced issue #30: the game and
the backend deploy from the same push instead of the backend waiting on somebody
to remember it. The game's own workflow still only publishes `dist/` — it is
Cloudflare, not GitHub Actions, that ships the worker.

> **Status: the connection exists but its builds are not yet succeeding.** Until
> one goes green, the section above describes the intended route rather than the
> working one, and deploys go through the dashboard-paste fallback at the bottom
> of this file — which is how the current v0.9.5+ worker got live. Delete this
> note in the commit that gets a build passing. It is here because a document
> that confidently describes a deployment path that does not work is exactly what
> let issue #30 sit open for a week.

### The one rule that will bite you

**A deploy makes the live worker match `wrangler.toml`, replacing whatever is
configured in the dashboard** — both `[vars]` and bindings. So:

- `database_id` must be the real id of the live D1 database. A wrong or
  placeholder value silently detaches the worker from its data and every request
  returns `500 {"error":"storage unavailable"}`.
- Setting `ALLOWED_ORIGIN` by hand in the dashboard is redundant: the value in
  this file wins on the next deploy. Change it here, not there.

Both are correct in the committed file. Editing bindings or vars in the
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

```sh
curl -si <worker-url>/scores | grep -i access-control-allow-origin
```

should print a line containing `*`. Nothing means CORS is unconfigured — check
that the deploy actually replaced the code. Then POST the same score twice:
`201` then `409`. The `409` is duplicate suppression, which exists only in
v0.9.5+, so it is the clearest single proof of which code is live.

A `500 storage unavailable` means the worker could not reach its data, but it
does **not** pin down why: `storageError` normalizes every D1 exception into that
one response, so a wrong binding, a missing table, a half-applied migration and a
transient D1 outage all look identical from outside. Nor is a `201` proof the
binding is right — a different database with the same schema answers just as
happily. Check the binding in `wrangler.toml` against `npx wrangler d1 list`, and
the build log, before assuming which it is.

### Fallbacks, if the Git deploy is unavailable

**By hand in the dashboard.** Worker → **Edit Code** → replace everything with
`worker.dashboard.js` → Deploy. That file is committed and CI fails if it drifts
from `scores.js` + `worker.js`, so copy it as-is; `npm run build:dashboard` is
only needed if you edited `server/*.js` yourself. Note this route does **not**
apply `wrangler.toml`, so bindings and vars must already be right in the
dashboard.

**With wrangler.** `wrangler.toml` supplies the binding and the variable, so it
is just:

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

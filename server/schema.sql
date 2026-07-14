-- Leaderboard scores. created_at is unix milliseconds from the server clock;
-- the 30-day rolling window and all ordering are computed against it.
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  initials TEXT NOT NULL,    -- exactly 3 chars, A-Z0-9, uppercased by the worker
  floor INTEGER NOT NULL,
  turns INTEGER NOT NULL,
  seed TEXT NOT NULL,
  version TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scores_created ON scores (created_at);

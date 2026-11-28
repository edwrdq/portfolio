-- "now" history: what eddy was doing, sampled every minute by the site's cron.
-- one row per continuous session (a gap of > 3 min starts a new one).
-- stored: kind + game/project name + times. never: songs, artists, raw presence.

CREATE TABLE now_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT    NOT NULL CHECK (kind IN ('coding', 'playing', 'watching', 'streaming', 'competing', 'listening')),
  name         TEXT             CHECK (name IS NULL OR length(name) <= 80),   -- game / project. null for listening
  started_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX now_sessions_open ON now_sessions (kind, name, last_seen_at DESC);
CREATE INDEX now_sessions_seen ON now_sessions (last_seen_at DESC);

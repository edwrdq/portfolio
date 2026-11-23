-- "now" rich presence: manual statuses + manual "listening to" tracks.
-- one row per set; history = all rows. the active one is the newest that
-- hasn't expired or been cleared.

CREATE TABLE now_status (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL CHECK (kind IN ('status', 'track')),
  text       TEXT    NOT NULL CHECK (length(text) BETWEEN 1 AND 120),   -- status line, or track title
  tag        TEXT             CHECK (tag IS NULL OR tag IN ('coding', 'lifting', 'at the shop', 'listening')),
  artist     TEXT             CHECK (artist IS NULL OR length(artist) <= 120),
  url        TEXT             CHECK (url IS NULL OR length(url) <= 500),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER,          -- null = never
  cleared_at INTEGER           -- set when replaced or cleared by hand
);

CREATE INDEX now_status_kind_created ON now_status (kind, created_at DESC);

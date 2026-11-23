-- link shortener: edwrdq.com/x/<slug> → url

CREATE TABLE links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 40 AND slug = lower(slug)),
  url        TEXT    NOT NULL CHECK (length(url) BETWEEN 8 AND 2000),
  clicks     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER,                                            -- null = never
  disabled   INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1))
);

CREATE INDEX links_created ON links (created_at DESC);

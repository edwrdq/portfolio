-- later: read-later queue + phone ↔ laptop link/note transfer.
CREATE TABLE later_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT             CHECK (url IS NULL OR length(url) <= 2000),   -- null for note items
  title      TEXT             CHECK (title IS NULL OR length(title) <= 300),
  site       TEXT             CHECK (site IS NULL OR length(site) <= 120),
  excerpt    TEXT             CHECK (excerpt IS NULL OR length(excerpt) <= 600),
  note       TEXT             CHECK (note IS NULL OR length(note) <= 20000), -- body of a plain-text item
  tags       TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'read', 'archived')),
  sent_from  TEXT    NOT NULL DEFAULT 'laptop' CHECK (sent_from IN ('phone', 'laptop')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  read_at    INTEGER
);
CREATE INDEX later_status_created ON later_items (status, created_at DESC);

CREATE TABLE later_archive (
  item_id    INTEGER PRIMARY KEY REFERENCES later_items (id) ON DELETE CASCADE,
  text       TEXT    NOT NULL,                       -- extracted article text, plain
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);

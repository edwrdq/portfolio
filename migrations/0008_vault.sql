-- vault: commands / fixes / snippets. never secrets (the ui warns on save).
CREATE TABLE vault_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body         TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  lang         TEXT    NOT NULL DEFAULT 'sh' CHECK (length(lang) <= 20),
  note         TEXT             CHECK (note IS NULL OR length(note) <= 2000),
  tags         TEXT    NOT NULL DEFAULT '',          -- comma list, lowercase
  pinned       INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  uses         INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX vault_pinned_uses ON vault_entries (pinned DESC, uses DESC);

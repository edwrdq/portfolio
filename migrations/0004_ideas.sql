-- idea inbox: fast capture from anywhere (mostly a phone), plus follow-up notes.

CREATE TABLE ideas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  body       TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  tags       TEXT    NOT NULL DEFAULT '',                      -- comma list, lowercase, from #tags in the body
  status     TEXT    NOT NULL DEFAULT 'raw' CHECK (status IN ('raw', 'thinking', 'doing', 'dead')),
  pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX ideas_pinned_created ON ideas (pinned DESC, created_at DESC);

CREATE TABLE idea_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id    INTEGER NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  body       TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idea_notes_idea_created ON idea_notes (idea_id, created_at);

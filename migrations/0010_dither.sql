-- dither: saved parameter presets for the dither playground.
CREATE TABLE dither_presets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 40),
  params     TEXT    NOT NULL,                       -- json
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

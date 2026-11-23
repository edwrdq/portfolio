-- pixel: saved 8×8 icons. grid = 8 rows of "." / "#", joined with "\n".
CREATE TABLE pixel_icons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 40),
  grid       TEXT    NOT NULL CHECK (length(grid) = 71),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

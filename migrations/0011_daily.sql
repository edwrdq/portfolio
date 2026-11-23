-- daily puzzles: anonymous per-day counters for "x% solved today". no ids, no ips, nothing per person.
CREATE TABLE daily_stats (
  game TEXT NOT NULL CHECK (length(game) BETWEEN 1 AND 32),
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  plays INTEGER NOT NULL DEFAULT 0,
  solves INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game, date)
);

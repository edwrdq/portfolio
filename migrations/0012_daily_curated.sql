-- curated daily content, managed in admin → daily. nothing goes live unless status = 'approved'
-- and it's scheduled for that date. rows written by the agent start as 'unverified'.

-- the diagnose bank: one car problem per day, five clues
CREATE TABLE diagnose_cases (
  id INTEGER PRIMARY KEY,
  vehicle TEXT NOT NULL,        -- json {year, make, model, engine, miles?}
  complaint TEXT NOT NULL,
  symptoms TEXT NOT NULL,       -- json string[]
  codes TEXT NOT NULL,          -- json [{code, desc, status}]
  live_data TEXT NOT NULL,      -- json [{label, value, unit, note?}]
  test_result TEXT NOT NULL,    -- json {name, result}
  answer TEXT NOT NULL,         -- id of the right choice
  choices TEXT NOT NULL,        -- json [{id, label}]
  explanation TEXT NOT NULL,
  clue_notes TEXT NOT NULL,     -- json string[5]: how each clue pointed to the answer
  flags TEXT NOT NULL DEFAULT '[]', -- json string[]: things eddy should double-check
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'approved')),
  author TEXT NOT NULL DEFAULT 'eddy' CHECK (author IN ('eddy', 'agent')),
  scheduled_for TEXT UNIQUE,    -- YYYY-MM-DD (new york), null = in the queue
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- the estimate bank: fermi questions with a checkable source
CREATE TABLE estimate_questions (
  id INTEGER PRIMARY KEY,
  question TEXT NOT NULL CHECK (length(question) BETWEEN 5 AND 400),
  answer REAL NOT NULL CHECK (answer > 0),
  unit TEXT NOT NULL DEFAULT '',
  reasoning TEXT NOT NULL,
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%' OR source_url LIKE 'http://%'),
  flags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'approved')),
  author TEXT NOT NULL DEFAULT 'eddy' CHECK (author IN ('eddy', 'agent')),
  scheduled_for TEXT UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- hand-made puzzles for any game: asm snippets, logic proofs, or a fixed puzzle on a date
CREATE TABLE daily_overrides (
  id INTEGER PRIMARY KEY,
  game TEXT NOT NULL CHECK (length(game) BETWEEN 1 AND 32),
  kind TEXT NOT NULL,           -- 'asm' | 'order' | 'badstep' | …
  data TEXT NOT NULL,           -- json, shape depends on kind
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'approved')),
  author TEXT NOT NULL DEFAULT 'eddy' CHECK (author IN ('eddy', 'agent')),
  scheduled_for TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (game, scheduled_for)
);

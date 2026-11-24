-- multiplayer rooms (edwrdq-rooms worker, one durable object per room).
-- chat itself is never stored here: it lives in each room's own storage and is wiped when the
-- room closes. only reported messages land in d1. no raw ips or session ids anywhere — hashes only.

-- open rooms, for quick play and the admin live list. a row exists while the room does.
CREATE TABLE rooms (
  code TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  public INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'lobby' CHECK (state IN ('lobby', 'playing')),
  players INTEGER NOT NULL DEFAULT 0, -- humans holding a seat (incl. the 30s reconnect window)
  max INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX rooms_quick ON rooms (game, public, state, updated_at);

-- reported chat messages, for review in admin → rooms
CREATE TABLE room_reports (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  game TEXT NOT NULL,
  nick TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at INTEGER NOT NULL,          -- unix ms the message was sent
  sid_hash TEXT NOT NULL,            -- sender's hashed session
  ip_hash TEXT,                      -- sender's hashed ip (IP_SALT)
  reporter_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'banned')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (code, sent_at, sid_hash, reporter_hash)
);
CREATE INDEX room_reports_open ON room_reports (status, created_at);

-- bans: either hash matches. expires_at null = forever.
CREATE TABLE room_bans (
  id INTEGER PRIMARY KEY,
  sid_hash TEXT,
  ip_hash TEXT,
  nick TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER
);
CREATE INDEX room_bans_sid ON room_bans (sid_hash);
CREATE INDEX room_bans_ip ON room_bans (ip_hash);

-- kill switches + the banned-words list (edited in admin, never in the repo)
CREATE TABLE rooms_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO rooms_settings (key, value) VALUES ('chat_off', '0'), ('play_off', '0'), ('banned_words', '');

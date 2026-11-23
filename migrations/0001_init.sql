-- guestbook messages + blog comments. plain text only; escaped on render.
-- ip_hash = sha256(ip + IP_SALT). raw ips are never stored.

CREATE TABLE messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  body       TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  name       TEXT             CHECK (name IS NULL OR length(name) <= 40),
  status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  ip_hash    TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX messages_status_created ON messages (status, created_at DESC);
CREATE INDEX messages_ip_created     ON messages (ip_hash, created_at);

CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL,
  body       TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  name       TEXT             CHECK (name IS NULL OR length(name) <= 40),
  reply      TEXT             CHECK (reply IS NULL OR length(reply) <= 2000),
  status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  ip_hash    TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX comments_slug_status_created ON comments (slug, status, created_at);
CREATE INDEX comments_status_created      ON comments (status, created_at DESC);
CREATE INDEX comments_ip_created          ON comments (ip_hash, created_at);

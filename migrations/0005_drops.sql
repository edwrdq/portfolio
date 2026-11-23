-- drop: private expiring file links. files live in r2 (edwrdq-drop) under drops/<token>/.

CREATE TABLE drops (
  token          TEXT    PRIMARY KEY,                       -- 128-bit random, base64url
  note           TEXT             CHECK (note IS NULL OR length(note) <= 1000),
  expires_at     INTEGER NOT NULL,
  max_downloads  INTEGER          CHECK (max_downloads IS NULL OR max_downloads > 0),
  download_count INTEGER NOT NULL DEFAULT 0,
  password_hash  TEXT,                                      -- pbkdf2$<iter>$<salt>$<hash>
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  ready          INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1)),  -- 1 once every file finished uploading
  pw_fails       INTEGER NOT NULL DEFAULT 0,                -- wrong passwords in the current window
  pw_window      INTEGER NOT NULL DEFAULT 0                 -- unix start of that window
);

CREATE INDEX drops_expires ON drops (expires_at);

CREATE TABLE drop_files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  drop_token   TEXT    NOT NULL REFERENCES drops (token) ON DELETE CASCADE,
  idx          INTEGER NOT NULL,
  r2_key       TEXT    NOT NULL UNIQUE,
  filename     TEXT    NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  size         INTEGER NOT NULL CHECK (size >= 0),
  content_type TEXT,
  upload_id    TEXT,                                        -- r2 multipart upload in progress
  done         INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  UNIQUE (drop_token, idx)
);

-- issued when someone presses DOWNLOAD (after the password, if any). lets the
-- browser fetch each file — and resume — without the password in a url.
CREATE TABLE drop_tickets (
  ticket     TEXT    PRIMARY KEY,
  drop_token TEXT    NOT NULL REFERENCES drops (token) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX drop_tickets_drop ON drop_tickets (drop_token, expires_at);

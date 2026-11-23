-- self-hosted visitor map. daily aggregates only: no ips, no per-visitor rows, no cookies.
-- coordinates are cloudflare's city-level geo, rounded to 1 decimal (~11km).
-- '' (not NULL) for unknowns so the unique key actually dedupes.

CREATE TABLE visits_daily (
  date    TEXT    NOT NULL,                 -- yyyy-mm-dd (utc)
  country TEXT    NOT NULL DEFAULT '',      -- iso 3166-1 alpha-2
  city    TEXT    NOT NULL DEFAULT '',
  lat     REAL,
  lon     REAL,
  path    TEXT    NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, country, city, path)
);

CREATE INDEX visits_daily_date ON visits_daily (date);

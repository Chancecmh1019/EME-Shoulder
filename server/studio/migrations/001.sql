PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_key TEXT NOT NULL, input_hash TEXT NOT NULL,
 title TEXT NOT NULL, context TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(owner, request_key)
);
CREATE TABLE IF NOT EXISTS tracks (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), owner TEXT NOT NULL,
 title TEXT NOT NULL, position INTEGER NOT NULL, revision INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('TRANSLATE','NEEDS_REVIEW','ALIGN','CANCELLED')),
 UNIQUE(job_id, position)
);
CREATE TABLE IF NOT EXISTS sources (
 track_id TEXT NOT NULL REFERENCES tracks(id), revision INTEGER NOT NULL,
 source_hash TEXT NOT NULL, raw TEXT NOT NULL, lines TEXT NOT NULL, removed TEXT NOT NULL,
 PRIMARY KEY(track_id, revision)
);
CREATE TABLE IF NOT EXISTS translations (
 track_id TEXT NOT NULL REFERENCES tracks(id), revision INTEGER NOT NULL, prompt_hash TEXT NOT NULL,
 receipt_key TEXT NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(track_id, revision), UNIQUE(track_id, receipt_key)
);
CREATE TABLE IF NOT EXISTS events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id),
 track_id TEXT, kind TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER IF NOT EXISTS sources_no_update BEFORE UPDATE ON sources BEGIN SELECT RAISE(ABORT,'immutable source'); END;
CREATE TRIGGER IF NOT EXISTS sources_no_delete BEFORE DELETE ON sources BEGIN SELECT RAISE(ABORT,'immutable source'); END;
CREATE TRIGGER IF NOT EXISTS translations_no_update BEFORE UPDATE ON translations BEGIN SELECT RAISE(ABORT,'immutable translation'); END;
CREATE TRIGGER IF NOT EXISTS translations_no_delete BEFORE DELETE ON translations BEGIN SELECT RAISE(ABORT,'immutable translation'); END;
CREATE TABLE IF NOT EXISTS leases (
 track_id TEXT PRIMARY KEY REFERENCES tracks(id), worker TEXT NOT NULL, token TEXT NOT NULL,
 expires_at INTEGER NOT NULL, attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 3)
);
PRAGMA user_version = 1;
CREATE TABLE IF NOT EXISTS rate_limits (
 owner TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pair_inputs (
 track_id TEXT PRIMARY KEY REFERENCES tracks(id), audio_id TEXT NOT NULL, audio_hash TEXT NOT NULL,
 inspection TEXT NOT NULL, state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pair_reports (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, track_id TEXT NOT NULL REFERENCES tracks(id), revision INTEGER NOT NULL,
 source_hash TEXT NOT NULL, audio_id TEXT NOT NULL, audio_hash TEXT NOT NULL, status TEXT NOT NULL,
 evidence TEXT NOT NULL, report TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS pair_reports_no_update BEFORE UPDATE ON pair_reports BEGIN SELECT RAISE(ABORT,'immutable verification'); END;
CREATE TRIGGER IF NOT EXISTS pair_reports_no_delete BEFORE DELETE ON pair_reports BEGIN SELECT RAISE(ABORT,'immutable verification'); END;
PRAGMA user_version = 2;

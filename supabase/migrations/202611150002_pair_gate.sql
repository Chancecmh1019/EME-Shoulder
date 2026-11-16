BEGIN;
CREATE TABLE IF NOT EXISTS eme.pair_inputs (
 track_id TEXT PRIMARY KEY REFERENCES eme.tracks(id), audio_id TEXT NOT NULL REFERENCES eme.assets(id), audio_hash TEXT NOT NULL,
 inspection TEXT NOT NULL, state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eme.pair_reports (
 sequence BIGSERIAL PRIMARY KEY, track_id TEXT NOT NULL REFERENCES eme.tracks(id), revision BIGINT NOT NULL,
 source_hash TEXT NOT NULL, audio_id TEXT NOT NULL REFERENCES eme.assets(id), audio_hash TEXT NOT NULL, status TEXT NOT NULL,
 evidence TEXT NOT NULL, report TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TRIGGER pair_reports_immutable BEFORE UPDATE OR DELETE ON eme.pair_reports FOR EACH ROW EXECUTE FUNCTION eme.immutable_record();
ALTER TABLE eme.pair_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE eme.pair_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_only ON eme.pair_inputs TO eme_app USING(true) WITH CHECK(true);
CREATE POLICY backend_only ON eme.pair_reports TO eme_app USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON eme.pair_inputs TO eme_app;
GRANT SELECT,INSERT ON eme.pair_reports TO eme_app;
GRANT USAGE,SELECT ON SEQUENCE eme.pair_reports_sequence_seq TO eme_app;
REVOKE ALL ON eme.pair_inputs,eme.pair_reports FROM PUBLIC;
COMMIT;

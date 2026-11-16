-- Run manually against a NEW isolated staging database using the Supabase SQL editor.
BEGIN;
CREATE SCHEMA IF NOT EXISTS eme;
REVOKE ALL ON SCHEMA eme FROM PUBLIC;
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='eme_app') THEN CREATE ROLE eme_app NOLOGIN; END IF; END $$;

CREATE TABLE IF NOT EXISTS eme.jobs (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_key TEXT NOT NULL, input_hash TEXT NOT NULL,
 title TEXT NOT NULL, context TEXT NOT NULL, created_at BIGINT NOT NULL,
 UNIQUE(owner, request_key)
);
CREATE TABLE IF NOT EXISTS eme.tracks (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES eme.jobs(id), owner TEXT NOT NULL,
 title TEXT NOT NULL, position BIGINT NOT NULL, revision BIGINT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('TRANSLATE','NEEDS_REVIEW','ALIGN','CANCELLED')),
 UNIQUE(job_id, position)
);
CREATE TABLE IF NOT EXISTS eme.sources (
 track_id TEXT NOT NULL REFERENCES eme.tracks(id), revision BIGINT NOT NULL,
 source_hash TEXT NOT NULL, raw TEXT NOT NULL, lines TEXT NOT NULL, removed TEXT NOT NULL,
 PRIMARY KEY(track_id, revision)
);
CREATE TABLE IF NOT EXISTS eme.translations (
 track_id TEXT NOT NULL REFERENCES eme.tracks(id), revision BIGINT NOT NULL, prompt_hash TEXT NOT NULL,
 receipt_key TEXT NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL, created_at BIGINT NOT NULL,
 PRIMARY KEY(track_id, revision), UNIQUE(track_id, receipt_key)
);
CREATE TABLE IF NOT EXISTS eme.events (
 sequence BIGSERIAL PRIMARY KEY, owner TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES eme.jobs(id),
 track_id TEXT, kind TEXT NOT NULL, data TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS eme.leases (
 track_id TEXT PRIMARY KEY REFERENCES eme.tracks(id), worker TEXT NOT NULL, token TEXT NOT NULL,
 expires_at BIGINT NOT NULL, attempt BIGINT NOT NULL CHECK(attempt BETWEEN 1 AND 3)
);

CREATE TABLE IF NOT EXISTS eme.rate_limits (
 owner TEXT PRIMARY KEY, window_start BIGINT NOT NULL, count BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS eme.sessions (
 token_hash text PRIMARY KEY, owner text NOT NULL, role text NOT NULL CHECK(role IN ('owner','dot')),
 grant_id text, expires_at bigint NOT NULL, revoked_at bigint, created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS eme.login_challenges (
 hash text PRIMARY KEY, expires_at bigint NOT NULL, attempts integer NOT NULL CHECK(attempts BETWEEN 0 AND 5)
);
CREATE TABLE IF NOT EXISTS eme.device_pairs (
 code_hash text UNIQUE NOT NULL, device_hash text PRIMARY KEY, owner text,
 grant_id text, expires_at bigint NOT NULL, approved_at bigint
);
CREATE TABLE IF NOT EXISTS eme.dot_grants (
 id text PRIMARY KEY, owner text NOT NULL, expires_at bigint NOT NULL, revoked_at bigint, created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS eme.dot_jobs (
 grant_id text NOT NULL REFERENCES eme.dot_grants(id), job_id text UNIQUE NOT NULL REFERENCES eme.jobs(id),
 PRIMARY KEY(grant_id,job_id)
);
CREATE TABLE IF NOT EXISTS eme.assets (
 id text PRIMARY KEY, owner text NOT NULL, job_id text NOT NULL REFERENCES eme.jobs(id),
 sha256 text NOT NULL, storage_key text NOT NULL UNIQUE, mime text NOT NULL, bytes bigint NOT NULL CHECK(bytes>0 AND bytes<=3145728),
 kind text NOT NULL CHECK(kind IN ('audio','artwork','source_lrc','output')), status text NOT NULL CHECK(status IN ('pending','ready','failed')),
 inspected jsonb NOT NULL, created_at bigint NOT NULL, UNIQUE(owner,job_id,sha256,kind)
);
CREATE TABLE IF NOT EXISTS eme.security_events (
 sequence bigserial PRIMARY KEY, owner text NOT NULL, kind text NOT NULL, subject text NOT NULL, created_at bigint NOT NULL
);
CREATE OR REPLACE FUNCTION eme.immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable record'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['events','sources','translations','security_events'] LOOP
  IF NOT EXISTS (SELECT FROM pg_trigger WHERE tgname=t||'_immutable' AND tgrelid=('eme.'||t)::regclass) THEN
   EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON eme.%I FOR EACH ROW EXECUTE FUNCTION eme.immutable_record()',t||'_immutable',t);
  END IF;
 END LOOP;
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='eme' LOOP
  EXECUTE format('ALTER TABLE eme.%I ENABLE ROW LEVEL SECURITY',t);
  -- The dedicated backend role has explicit policies; anon/authenticated have no access.
  IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='eme' AND tablename=t AND policyname='backend_only') THEN
   EXECUTE format('CREATE POLICY backend_only ON eme.%I TO eme_app USING (true) WITH CHECK (true)',t);
  END IF;
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA eme TO eme_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA eme TO eme_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA eme TO eme_app;
REVOKE UPDATE,DELETE ON eme.events,eme.sources,eme.translations,eme.security_events FROM eme_app;
REVOKE ALL ON ALL TABLES IN SCHEMA eme FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON SCHEMA eme FROM anon; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON SCHEMA eme FROM authenticated; END IF;
END $$;
COMMIT;

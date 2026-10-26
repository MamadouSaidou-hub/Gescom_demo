-- Append-only, hash-chained audit trail — applied manually against Neon (not via drizzle-kit).
-- Kept here for review/reproducibility.
--
-- Two properties matter, and both are enforced by the database rather than by application code:
--   1. The chain (prev_hash/entry_hash) is computed by a BEFORE INSERT trigger, so no caller can
--      supply, forge or forget it — including a raw psql INSERT.
--   2. Append-only comes from privileges: app_runtime holds INSERT+SELECT and nothing else, so a
--      fully compromised application still cannot rewrite or erase history.
--
-- This makes the log tamper-*evident*, not tamper-proof: the owner role (migrations) can still
-- delete rows, but doing so breaks chain verification and is therefore detectable — see
-- verifyAuditChain() in lib/audit.ts and tests/audit-log.test.ts.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  -- NULL for platform-level events (e.g. tenant creation) that belong to no single tenant.
  tenant_id INTEGER REFERENCES tenants(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Defaults exist only so application inserts typecheck without them; the trigger always overwrites.
  prev_hash TEXT NOT NULL DEFAULT '',
  entry_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_tenant_id_idx ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at DESC);

CREATE OR REPLACE FUNCTION audit_log_chain() RETURNS trigger AS $$
DECLARE
  last_hash TEXT;
  ts TIMESTAMPTZ;
BEGIN
  -- Serializes concurrent inserts so two transactions can never both read the same "last entry"
  -- and fork the chain. Scoped to this table, held for the transaction only.
  PERFORM pg_advisory_xact_lock(hashtext('audit_log_chain'));

  SELECT entry_hash INTO last_hash FROM audit_log ORDER BY id DESC LIMIT 1;
  IF last_hash IS NULL THEN
    last_hash := 'genesis';
  END IF;

  ts := COALESCE(NEW.created_at, now());
  NEW.created_at := ts;
  NEW.prev_hash := last_hash;
  NEW.entry_hash := encode(
    digest(
      last_hash || '|' || NEW.actor_id || '|' || NEW.action || '|' || NEW.target_type || '|' || NEW.target_id || '|' || NEW.payload::text || '|' || ts::text,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_chain_trigger ON audit_log;
CREATE TRIGGER audit_log_chain_trigger
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

-- Privileges. NOTE: `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE` was set on
-- this schema when app_runtime was created (see 0000_multi_tenant_foundation.sql §5), so a new
-- table starts out fully writable by the app. An additive GRANT does NOT take that away — the
-- REVOKE below is what actually makes this table append-only, and skipping it silently defeats the
-- entire purpose of the trail.
GRANT SELECT, INSERT ON audit_log TO app_runtime;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO app_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;

-- Also added in this migration (platform console):
-- ALTER TABLE "user" ADD COLUMN platform_admin BOOLEAN NOT NULL DEFAULT false;
-- GRANT INSERT, UPDATE ON tenants TO app_runtime;  -- tenant provisioning + suspension from the UI
-- CREATE TABLE rate_limit (id TEXT PRIMARY KEY, key TEXT NOT NULL, count INTEGER NOT NULL, last_request BIGINT NOT NULL);
-- GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit TO app_runtime;  -- better-auth persistent rate limiting

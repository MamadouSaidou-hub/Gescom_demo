-- Multi-tenant foundation — applied manually against Neon (not via drizzle-kit) on the dates these
-- scripts were run. Kept here for review/reproducibility, not for drizzle-kit to execute.
--
-- Summary:
--   1. New `tenants` table; `tenant_id` added to every business table + `user`, backfilled to a
--      single tenant (the pre-existing demo data), then made NOT NULL with an FK to tenants(id).
--   2. `products.sku` uniqueness changed from global to per-(tenant_id, sku).
--   3. `app_settings.id` changed from a fixed default of 1 to a real sequence (one row per tenant
--      now, keyed uniquely by tenant_id instead of a single id=1 row).
--   4. A non-owner Postgres role `app_runtime` (LOGIN, no CREATE, not table owner) created and
--      granted SELECT/INSERT/UPDATE/DELETE on every table — this is the role the app connects as
--      (DATABASE_URL_RUNTIME in .env.local). The owner role (DATABASE_URL) is reserved for
--      migrations/admin scripts and bypasses RLS, same as any table owner.
--   5. Row-Level Security enabled + a `tenant_isolation` policy on every business table (NOT on
--      user/session/account/verification — see note below).

-- ── 1. tenants table ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  country TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

-- ── 2. tenant_id on every business table (pattern repeated per table) ─────────────────────────────
-- ALTER TABLE <table> ADD COLUMN tenant_id INTEGER;
-- UPDATE <table> SET tenant_id = <existing_tenant_id> WHERE tenant_id IS NULL;
-- ALTER TABLE <table> ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE <table> ADD CONSTRAINT <table>_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
-- CREATE INDEX <table>_tenant_id_idx ON <table>(tenant_id);
-- Applied to: stores, products, stock_levels, stock_movements, stock_counts, clients, sales,
-- sale_items, payments, receivables, transfers, transfer_items, suppliers, supplier_deliveries,
-- supplier_payables, supplier_payments, cash_accounts, cash_movements, discount_scales,
-- discount_tiers, discount_applications, app_settings, "user".

-- ── 3. products.sku: global unique -> per-tenant ───────────────────────────────────────────────
-- ALTER TABLE products DROP CONSTRAINT products_sku_unique; -- (name as it existed before)
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_sku_unique ON products(tenant_id, sku);

-- sales.reference and transfers.reference stay globally unique on purpose — generated from a
-- global Postgres sequence, already collision-free even across tenants (see tests/tenant-isolation.test.ts).

-- ── 4. app_settings: one row per tenant instead of a fixed id=1 row ───────────────────────────────
CREATE SEQUENCE IF NOT EXISTS app_settings_id_seq OWNED BY app_settings.id;
SELECT setval('app_settings_id_seq', COALESCE((SELECT MAX(id) FROM app_settings), 0) + 1, false);
ALTER TABLE app_settings ALTER COLUMN id SET DEFAULT nextval('app_settings_id_seq');
CREATE UNIQUE INDEX IF NOT EXISTS app_settings_tenant_id_unique ON app_settings(tenant_id);

-- ── 5. Non-owner runtime role ───────────────────────────────────────────────────────────────────
-- CREATE ROLE app_runtime LOGIN PASSWORD '<generated>';
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT ON tenants TO app_runtime; -- no INSERT: tenant provisioning is an owner-only CLI operation (scripts/create-tenant.ts)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO app_runtime; -- for every business table + user/session/account/verification
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
-- Verified: app_runtime owns zero tables, rolsuper=false, rolbypassrls=false — a table owner (or
-- a role with BYPASSRLS) is exempt from RLS regardless of policies, so this is load-bearing, not
-- cosmetic.

-- ── 6. Row-Level Security ───────────────────────────────────────────────────────────────────────
-- Applied to every business table listed in §2 above (NOT to user/session/account/verification —
-- better-auth's login flow must find a `user` row by email before any tenant is known, so RLS on
-- `user` would make login impossible; `tenant_id` on `user` is a plain column, access to it is
-- controlled entirely at the application layer, e.g. app/api/utilisateurs/**).
--
-- NULLIF(..., '') matters: once a pooled connection's session has called set_config('app.tenant_id',
-- ..., true) at least once, Postgres treats that custom GUC as "known" for the rest of the
-- session — current_setting(..., true) then returns '' (not NULL) once the transaction that set
-- it ends, and casting '' to int throws instead of failing closed. NULLIF normalizes '' to NULL
-- first so an unset tenant always resolves to zero rows, never an error.
--
-- ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;  -- NOT "FORCE" — app_runtime isn't the owner, so
--                                                  -- RLS already applies to it without FORCE; FORCE
--                                                  -- would also restrict the owner role used by
--                                                  -- migration/admin scripts, which must stay exempt.
-- CREATE POLICY tenant_isolation ON <table>
--   USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int)
--   WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int);

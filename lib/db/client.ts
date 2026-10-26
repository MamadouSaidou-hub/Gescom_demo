import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'
import * as authSchema from './auth-schema'

// The app's normal traffic must run as a non-owner role (app_runtime) so Postgres Row-Level
// Security actually applies — table owners bypass RLS regardless of policies. DATABASE_URL
// (the owner role) stays reserved for migrations/admin scripts; see lib/db/tenant.ts.
const connectionString = process.env.DATABASE_URL_RUNTIME ?? process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL_RUNTIME (or DATABASE_URL) is not set — expected a postgres:// connection string.')
}
if (!process.env.DATABASE_URL_RUNTIME) {
  console.warn('DATABASE_URL_RUNTIME is not set — falling back to DATABASE_URL (owner role). Row-Level Security will not protect this connection.')
}

const pool = new Pool({
  connectionString,
  // Supabase (and most managed Postgres) require TLS; node-postgres doesn't enable it automatically
  // just because the URL says postgres:// or sslmode=require.
  ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
  // In production this runs as many independent serverless function instances (one per route), so a
  // low per-instance max matters more than a high one there. Locally it's a single `next dev`
  // process handling every request, and every tenant-scoped query now opens its own transaction
  // (withTenant: BEGIN + set_config + query + COMMIT, vs. one autocommit statement before) — more
  // round trips held per logical query — so 5 connections starves fast under normal page-load
  // concurrency (dashboard + notifications + logo + branding, each its own transaction) and queued
  // queries start failing with "Connection terminated due to connection timeout".
  max: process.env.NODE_ENV === 'production' ? 5 : 15,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

// Without a listener, a dropped idle connection surfaces as an uncaught exception that crashes the
// whole process instead of just failing the next query that needs a fresh connection.
pool.on('error', (error) => {
  console.error('Unexpected error on idle Postgres client', error)
})

export const db = drizzle(pool, { schema: { ...schema, ...authSchema } })

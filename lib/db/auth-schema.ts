import { bigint, boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { stores, tenants } from './schema'

// tenantId is NOT RLS-protected (unlike every business table) — better-auth's drizzle adapter
// must be able to look up a user by email during login, before any tenant is known. The lookup
// itself stays safe because better-auth filters by the unique `email`; `tenantId` here is read
// *after* a successful credential check, purely to tell the rest of the app which tenant this
// session belongs to (see lib/session.ts).
export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull(),
    image: text('image'),
    role: text('role').notNull().default('gestionnaire'),
    storeId: integer('store_id').references(() => stores.id, { onDelete: 'set null' }),
    // Comma-joined list of lib/permissions.ts keys — only meaningful for role='gestionnaire'
    // (an 'admin' always has full access regardless of this value). Plain text, not a Postgres
    // array, so it works as a better-auth additionalField without array-type plumbing.
    permissions: text('permissions').notNull().default(''),
    // Platform operator (us), not a tenant's own admin — can create/list tenants across the whole
    // platform. Deliberately separate from `role`/tenant scoping; never settable via user input.
    platformAdmin: boolean('platform_admin').notNull().default(false),
    banned: boolean('banned').default(false),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('user_store_id_idx').on(table.storeId), index('user_tenant_id_idx').on(table.tenantId)],
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    impersonatedBy: text('impersonated_by'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    issuer: text('issuer'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
)

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

// Backs better-auth's `rateLimit: { storage: 'database' }` (see lib/auth.ts) — without this, rate
// limiting defaults to an in-memory Map, which doesn't persist across cold starts and isn't shared
// across serverless instances in production, so brute-force protection on /sign-in would be
// effectively a no-op once deployed. Global, not tenant-scoped (rate limiting is keyed by IP+path).
export const rateLimit = pgTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  count: integer('count').notNull(),
  // Milliseconds since epoch (Date.now()) — exceeds a 32-bit integer, needs bigint.
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})

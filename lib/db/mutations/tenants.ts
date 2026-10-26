import { desc, eq, sql } from 'drizzle-orm'
import { auth } from '../../auth'
import { db } from '../client'
import { withTenant } from '../tenant'
import { appSettings, stores, tenants } from '../schema'
import { user } from '../auth-schema'

export type CreateTenantInput = {
  name: string
  slug: string
  country: string
  currency: string
  adminEmail: string
  adminPassword: string
  adminName: string
  storeName: string
  storeCity: string
}

/**
 * Provisions a brand-new tenant: the tenants row itself, a default store + app_settings, and the
 * first admin account. `tenants` has no RLS (it's the platform registry, not tenant-scoped data)
 * — app_runtime was deliberately granted only SELECT/INSERT/UPDATE on it (no DELETE), and the only
 * gate on who can call this is `isPlatformAdmin()` at the call site (API route or CLI script).
 */
export async function createTenant(input: CreateTenantInput) {
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: input.name,
      slug: input.slug,
      country: input.country,
      currency: input.currency,
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    .returning()

  const storeId = await withTenant(tenant.id, async (tx) => {
    const [store] = await tx.insert(stores).values({ tenantId: tenant.id, name: input.storeName, city: input.storeCity }).returning()
    await tx.insert(appSettings).values({
      tenantId: tenant.id,
      companyName: input.name,
      companyShortName: input.name,
      country: input.country,
      currency: input.currency,
    })
    return store.id
  })

  // auth.api.createUser (admin plugin), not signUpEmail — signUpEmail attaches a session cookie to
  // whatever request context is active, which would hijack the caller's (the platform admin's) own
  // session if called from inside a route handler.
  await auth.api.createUser({
    body: {
      email: input.adminEmail,
      password: input.adminPassword,
      name: input.adminName,
      role: 'admin',
      data: { tenantId: tenant.id, storeId },
    },
  })

  return { tenant, storeId }
}

export type TenantStatus = 'active' | 'suspended'

/**
 * Flips a tenant between active and suspended. Suspension is enforced at login time
 * (lib/session.ts returns no context for a suspended tenant), so existing sessions stop working on
 * their next request rather than only at expiry.
 */
export async function setTenantStatus(tenantId: number, status: TenantStatus) {
  const [updated] = await db.update(tenants).set({ status }).where(eq(tenants.id, tenantId)).returning()
  return updated ?? null
}

export async function getTenant(tenantId: number) {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  return row ?? null
}

export async function listTenants() {
  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      country: tenants.country,
      currency: tenants.currency,
      status: tenants.status,
      createdAt: tenants.createdAt,
      userCount: sql<number>`(select count(*)::int from "user" where "user".tenant_id = "tenants"."id")`,
      adminEmail: sql<string | null>`(select email from "user" where "user".tenant_id = "tenants"."id" and "user".role = 'admin' order by "user".created_at asc limit 1)`,
    })
    .from(tenants)
    .orderBy(desc(tenants.id))
  return rows
}

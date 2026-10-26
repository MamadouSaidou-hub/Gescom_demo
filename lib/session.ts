import { headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db/client'
import { stores, tenants } from './db/schema'
import { withTenant } from './db/tenant'

// Suspension has to be checked on every request (not just at login) or a suspended client keeps
// working until their session expires. Cached briefly so this doesn't add a query to every single
// API call — a suspension therefore takes effect within TENANT_STATUS_TTL_MS, not instantly.
const TENANT_STATUS_TTL_MS = 15_000
const tenantStatusCache = new Map<number, { status: string; expiresAt: number }>()

/** Call after changing a tenant's status so the change isn't masked by the TTL. */
export function invalidateTenantStatus(tenantId: number) {
  tenantStatusCache.delete(tenantId)
}

async function getTenantStatus(tenantId: number): Promise<string | null> {
  const hit = tenantStatusCache.get(tenantId)
  if (hit && hit.expiresAt > Date.now()) return hit.status
  const [row] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId))
  if (!row) return null
  tenantStatusCache.set(tenantId, { status: row.status, expiresAt: Date.now() + TENANT_STATUS_TTL_MS })
  return row.status
}

export type SessionContext = {
  userId: string
  /** Carried for the audit trail so recording an event needs no extra lookup. */
  email: string
  role: string
  tenantId: number
  storeId: number | null
  storeName: string | null
  platformAdmin: boolean
}

/**
 * Distinguishes "not logged in" from "logged in but the workspace is suspended" — getSessionContext
 * collapses both to null (correct for API routes, which just return 401), but the UI needs to tell
 * a suspended client why nothing works instead of showing a wall of failed requests.
 */
export type SessionState =
  | { kind: 'anonymous' }
  | { kind: 'suspended' }
  | { kind: 'active'; ctx: SessionContext }

export async function getSessionState(): Promise<SessionState> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return { kind: 'anonymous' }

  const tenantId = (session.user as { tenantId?: number | null }).tenantId
  if (!tenantId) return { kind: 'anonymous' }

  // A suspended (or deleted) tenant gets no context at all — every route already treats a null
  // context as 401, so suspension locks the whole workspace without touching each route.
  const status = await getTenantStatus(tenantId)
  if (status !== 'active') return { kind: 'suspended' }

  const storeId = (session.user as { storeId?: number | null }).storeId ?? null
  let storeName: string | null = null
  if (storeId) {
    storeName = await withTenant(tenantId, async (tx) => {
      const [row] = await tx.select({ name: stores.name }).from(stores).where(eq(stores.id, storeId))
      return row?.name ?? null
    })
  }

  return {
    kind: 'active',
    ctx: {
      userId: session.user.id,
      email: session.user.email,
      role: (session.user as { role?: string }).role ?? 'gestionnaire',
      tenantId,
      storeId,
      storeName,
      platformAdmin: (session.user as { platformAdmin?: boolean }).platformAdmin ?? false,
    },
  }
}

export async function getSessionContext(): Promise<SessionContext | null> {
  const state = await getSessionState()
  return state.kind === 'active' ? state.ctx : null
}

export function isAdmin(ctx: SessionContext) {
  return ctx.role === 'admin'
}

export function isPlatformAdmin(ctx: SessionContext) {
  return ctx.platformAdmin === true
}

export function assertStoreAccess(ctx: SessionContext, storeId: number) {
  if (!isAdmin(ctx) && ctx.storeId !== storeId) {
    throw new Error('Accès refusé : ce magasin n’est pas le vôtre.')
  }
}

/** The store name to actually query with: the requested one for admins, always the user's own for a gestionnaire. */
export function effectiveStoreParam(ctx: SessionContext, requestedStore: string | null): string | null {
  return isAdmin(ctx) ? requestedStore : ctx.storeName
}

/** The store dropdown options to expose in a list response. */
export function scopedStoreList(ctx: SessionContext, allStoreNames: string[]): string[] {
  return isAdmin(ctx) ? ['Tous les magasins', ...allStoreNames] : ctx.storeName ? [ctx.storeName] : []
}

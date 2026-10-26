import { and, eq } from 'drizzle-orm'
import { withTenant } from '../tenant'
import { clients, stores } from '../schema'

export async function getStoreOptions(tenantId: number) {
  return withTenant(tenantId, async (tx) => {
    return tx.select({ id: stores.id, name: stores.name }).from(stores).where(eq(stores.tenantId, tenantId))
  })
}

export async function getClientOptions(tenantId: number) {
  return withTenant(tenantId, async (tx) => {
    return tx
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(eq(clients.tenantId, tenantId))
      .orderBy(clients.name)
  })
}

export async function resolveStoreId(tenantId: number, storeName: string | null) {
  if (!storeName || storeName === 'Tous les magasins') return null
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: stores.id })
      .from(stores)
      .where(and(eq(stores.name, storeName), eq(stores.tenantId, tenantId)))
    return row?.id ?? null
  })
}

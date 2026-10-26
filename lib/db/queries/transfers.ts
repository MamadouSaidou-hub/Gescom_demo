import { and, desc, eq, gte, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { withTenant } from '../tenant'
import { stores, transferItems, transfers } from '../schema'
import { periodRange, type PeriodKey } from '@/lib/period'
import { resolveStoreId } from './shared'

export async function getTransfersList(tenantId: number, period: PeriodKey, storeName: string | null) {
  const { start } = periodRange(period)
  const storeId = await resolveStoreId(tenantId, storeName)
  const storeFilter = storeId ? or(eq(transfers.fromStoreId, storeId), eq(transfers.toStoreId, storeId)) : undefined

  const fromStore = alias(stores, 'from_store')
  const toStore = alias(stores, 'to_store')

  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: transfers.id,
        reference: transfers.reference,
        createdAt: transfers.createdAt,
        status: transfers.status,
        fromStoreName: fromStore.name,
        toStoreName: toStore.name,
        itemCount: sql<number>`(select count(*) from ${transferItems} where ${transferItems.transferId} = ${transfers.id})`.mapWith(Number),
        totalQuantity: sql<number>`(select coalesce(sum(${transferItems.quantity}), 0) from ${transferItems} where ${transferItems.transferId} = ${transfers.id})`.mapWith(Number),
      })
      .from(transfers)
      .innerJoin(fromStore, eq(transfers.fromStoreId, fromStore.id))
      .innerJoin(toStore, eq(transfers.toStoreId, toStore.id))
      .where(and(gte(transfers.createdAt, start.toISOString()), eq(transfers.tenantId, tenantId), storeFilter))
      .orderBy(desc(transfers.createdAt))

    const pendingCount = rows.filter((row) => row.status !== 'completed').length
    const totalQuantity = rows.reduce((sum, row) => sum + row.totalQuantity, 0)

    return {
      transfers: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        date: row.createdAt,
        fromStore: row.fromStoreName,
        toStore: row.toStoreName,
        status: row.status,
        itemCount: row.itemCount,
        totalQuantity: row.totalQuantity,
      })),
      summary: {
        count: rows.length,
        pendingCount,
        totalQuantity,
      },
    }
  })
}

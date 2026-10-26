import { and, eq, gte } from 'drizzle-orm'
import { withTenant } from '../tenant'
import { products, sales, stockLevels, stores } from '../schema'
import { formatFcfa } from '@/lib/format'
import { periodRange } from '@/lib/period'

export async function getStoresOverview(tenantId: number) {
  const { start } = periodRange('month')

  return withTenant(tenantId, async (tx) => {
    const storeRows = await tx.select().from(stores).where(eq(stores.tenantId, tenantId))

    return Promise.all(
      storeRows.map(async (store) => {
        const salesRows = await tx
          .select({ total: sales.totalAmount })
          .from(sales)
          .where(and(eq(sales.storeId, store.id), gte(sales.createdAt, start.toISOString()), eq(sales.tenantId, tenantId)))
        const revenue = salesRows.reduce((sum, row) => sum + row.total, 0)

        const stockRows = await tx
          .select({ quantity: stockLevels.quantity, threshold: products.reorderThreshold })
          .from(stockLevels)
          .innerJoin(products, eq(stockLevels.productId, products.id))
          .where(and(eq(stockLevels.storeId, store.id), eq(stockLevels.tenantId, tenantId)))
        const totalStock = stockRows.reduce((sum, row) => sum + row.quantity, 0)
        const lowStock = stockRows.filter((row) => row.quantity <= row.threshold).length

        return {
          id: store.id,
          name: store.name,
          city: store.city,
          revenue: formatFcfa(revenue),
          salesCount: salesRows.length,
          totalStock,
          lowStock,
        }
      }),
    )
  })
}

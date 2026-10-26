import { and, eq } from 'drizzle-orm'
import { db } from '../client'
import { stockLevels } from '../schema'

type Queryable = Pick<typeof db, 'select'>

export async function getQuantity(tx: Queryable, tenantId: number, productId: number, storeId: number) {
  const [row] = await tx
    .select({ quantity: stockLevels.quantity })
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.storeId, storeId), eq(stockLevels.tenantId, tenantId)))
  return row?.quantity ?? 0
}

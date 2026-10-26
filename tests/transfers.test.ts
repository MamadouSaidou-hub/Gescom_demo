import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withTenant } from '@/lib/db/tenant'
import { products, stockLevels, stockMovements, stores, transferItems, transfers } from '@/lib/db/schema'
import { createTransfer, receiveTransfer } from '@/lib/db/mutations/transfers'

// Tenant 1 is the seeded demo tenant — see lib/db/seed.ts.
const tenantId = 1
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let fromStoreId: number
let toStoreId: number
let productId: number
const transferIds: number[] = []

async function stockOf(storeId: number) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({ quantity: stockLevels.quantity }).from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.storeId, storeId)))
    return row?.quantity ?? 0
  })
}

beforeAll(async () => {
  await withTenant(tenantId, async (tx) => {
    const [fromStore] = await tx.insert(stores).values({ tenantId, name: `Magasin origine ${runId}`, city: 'Test' }).returning()
    fromStoreId = fromStore.id
    const [toStore] = await tx.insert(stores).values({ tenantId, name: `Magasin destination ${runId}`, city: 'Test' }).returning()
    toStoreId = toStore.id

    const [product] = await tx
      .insert(products)
      .values({ tenantId, name: `Farine ${runId}`, sku: `SKU-${runId}`, category: 'Test', unitPrice: 1000, costPrice: 800 })
      .returning()
    productId = product.id

    await tx.insert(stockLevels).values({ tenantId, productId, storeId: fromStoreId, quantity: 100 })
  })
})

afterAll(async () => {
  await withTenant(tenantId, async (tx) => {
    await tx.delete(stockMovements).where(eq(stockMovements.productId, productId))
    for (const transferId of transferIds) {
      await tx.delete(transferItems).where(eq(transferItems.transferId, transferId))
      await tx.delete(transfers).where(eq(transfers.id, transferId))
    }
    await tx.delete(stockLevels).where(eq(stockLevels.productId, productId))
    await tx.delete(products).where(eq(products.id, productId))
    await tx.delete(stores).where(eq(stores.id, fromStoreId))
    await tx.delete(stores).where(eq(stores.id, toStoreId))
  })
})

describe('createTransfer', () => {
  it('decrements only the origin store', async () => {
    const transfer = await createTransfer(tenantId, { fromStoreId, toStoreId, items: [{ productId, quantity: 30 }] })
    transferIds.push(transfer.id)

    expect(await stockOf(fromStoreId)).toBe(70)
    expect(await stockOf(toStoreId)).toBe(0)
    expect(transfer.status).toBe('in_transit')
  })
})

describe('receiveTransfer', () => {
  it('increments the destination store and marks the transfer completed', async () => {
    const transfer = await createTransfer(tenantId, { fromStoreId, toStoreId, items: [{ productId, quantity: 20 }] })
    transferIds.push(transfer.id)

    const updated = await receiveTransfer(tenantId, transfer.id)
    expect(updated.status).toBe('completed')
    expect(await stockOf(toStoreId)).toBe(20)
  })

  it('rejects receiving the same transfer twice', async () => {
    const transfer = await createTransfer(tenantId, { fromStoreId, toStoreId, items: [{ productId, quantity: 5 }] })
    transferIds.push(transfer.id)

    await receiveTransfer(tenantId, transfer.id)
    await expect(receiveTransfer(tenantId, transfer.id)).rejects.toThrow(/déjà été marqué/i)
  })
})

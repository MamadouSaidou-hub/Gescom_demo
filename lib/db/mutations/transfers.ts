import { and, eq, sql } from 'drizzle-orm'
import { withTenant } from '../tenant'
import { products, stockLevels, stockMovements, transferItems, transfers } from '../schema'
import { getQuantity } from './shared'

export async function createTransfer(
  tenantId: number,
  input: {
    fromStoreId: number
    toStoreId: number
    items: { productId: number; quantity: number }[]
  },
) {
  if (input.items.length === 0) {
    throw new Error('Un transfert doit contenir au moins un article.')
  }
  if (input.fromStoreId === input.toStoreId) {
    throw new Error('Le magasin de destination doit être différent du magasin d’origine.')
  }

  return withTenant(tenantId, async (tx) => {
    const productRows = await tx.select().from(products).where(eq(products.tenantId, tenantId))
    const productMap = new Map(productRows.map((product) => [product.id, product]))

    for (const item of input.items) {
      const available = await getQuantity(tx, tenantId, item.productId, input.fromStoreId)
      if (available < item.quantity) {
        const product = productMap.get(item.productId)
        throw new Error(`Stock insuffisant pour ${product?.name ?? 'cet article'} (disponible : ${available}).`)
      }
    }

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(transfers)
      .where(eq(transfers.tenantId, tenantId))
    const reference = `TR-${1000 + count + 1}`

    const [transfer] = await tx
      .insert(transfers)
      .values({
        reference,
        fromStoreId: input.fromStoreId,
        toStoreId: input.toStoreId,
        status: 'in_transit',
        tenantId,
      })
      .returning()

    await tx.insert(transferItems).values(
      input.items.map((item) => ({ transferId: transfer.id, productId: item.productId, quantity: item.quantity, tenantId })),
    )

    for (const item of input.items) {
      const currentQuantity = await getQuantity(tx, tenantId, item.productId, input.fromStoreId)
      await tx
        .update(stockLevels)
        .set({ quantity: currentQuantity - item.quantity })
        .where(and(eq(stockLevels.productId, item.productId), eq(stockLevels.storeId, input.fromStoreId), eq(stockLevels.tenantId, tenantId)))
      await tx.insert(stockMovements).values({
        type: 'transfer_out',
        productId: item.productId,
        storeId: input.fromStoreId,
        quantity: -item.quantity,
        reference: transfer.reference,
        tenantId,
      })
    }

    return transfer
  })
}

export async function receiveTransfer(tenantId: number, transferId: number) {
  return withTenant(tenantId, async (tx) => {
    const [transfer] = await tx.select().from(transfers).where(and(eq(transfers.id, transferId), eq(transfers.tenantId, tenantId)))
    if (!transfer) {
      throw new Error('Transfert introuvable.')
    }
    if (transfer.status === 'completed') {
      throw new Error('Ce transfert a déjà été marqué comme reçu.')
    }

    const items = await tx.select().from(transferItems).where(and(eq(transferItems.transferId, transferId), eq(transferItems.tenantId, tenantId)))

    for (const item of items) {
      const [existing] = await tx
        .select({ id: stockLevels.id, quantity: stockLevels.quantity })
        .from(stockLevels)
        .where(and(eq(stockLevels.productId, item.productId), eq(stockLevels.storeId, transfer.toStoreId), eq(stockLevels.tenantId, tenantId)))

      if (existing) {
        await tx
          .update(stockLevels)
          .set({ quantity: existing.quantity + item.quantity })
          .where(and(eq(stockLevels.id, existing.id), eq(stockLevels.tenantId, tenantId)))
      } else {
        await tx.insert(stockLevels).values({
          productId: item.productId,
          storeId: transfer.toStoreId,
          quantity: item.quantity,
          tenantId,
        })
      }

      await tx.insert(stockMovements).values({
        type: 'transfer_in',
        productId: item.productId,
        storeId: transfer.toStoreId,
        quantity: item.quantity,
        reference: transfer.reference,
        tenantId,
      })
    }

    const [updated] = await tx
      .update(transfers)
      .set({ status: 'completed' })
      .where(and(eq(transfers.id, transferId), eq(transfers.tenantId, tenantId)))
      .returning()

    return updated
  })
}

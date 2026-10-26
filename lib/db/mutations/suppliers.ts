import { and, eq } from 'drizzle-orm'
import { withTenant } from '../tenant'
import { products, stockLevels, stockMovements, supplierDeliveries, supplierPayables, suppliers } from '../schema'
import { getQuantity } from './shared'
import { checkAndGrantSupplierCycle } from './discounts'

export async function createSupplier(tenantId: number, input: { name: string; phone?: string }) {
  return withTenant(tenantId, async (tx) => {
    const [supplier] = await tx.insert(suppliers).values({ name: input.name, phone: input.phone ?? null, tenantId }).returning()
    return supplier
  })
}

export async function recordSupplierDelivery(
  tenantId: number,
  input: {
    supplierId: number
    storeId: number
    productId: number
    sackCount: number
    tonnage?: number | null
    reference?: string
    paymentStatus: 'paid' | 'partial' | 'credit'
    paidNow: number
    dueInDays: number
  },
) {
  if (input.sackCount <= 0) {
    throw new Error('Le nombre de sacs doit être supérieur à zéro.')
  }

  const delivery = await withTenant(tenantId, async (tx) => {
    const [product] = await tx.select().from(products).where(and(eq(products.id, input.productId), eq(products.tenantId, tenantId)))
    if (!product) {
      throw new Error('Produit introuvable.')
    }

    const totalAmount = input.sackCount * product.costPrice

    const [delivery] = await tx
      .insert(supplierDeliveries)
      .values({
        supplierId: input.supplierId,
        storeId: input.storeId,
        productId: input.productId,
        reference: input.reference ?? null,
        sackCount: input.sackCount,
        tonnage: input.tonnage ?? null,
        totalAmount,
        tenantId,
      })
      .returning()

    const currentQuantity = await getQuantity(tx, tenantId, input.productId, input.storeId)
    await tx
      .update(stockLevels)
      .set({ quantity: currentQuantity + input.sackCount })
      .where(and(eq(stockLevels.productId, input.productId), eq(stockLevels.storeId, input.storeId), eq(stockLevels.tenantId, tenantId)))
    await tx.insert(stockMovements).values({
      type: 'reception',
      productId: input.productId,
      storeId: input.storeId,
      quantity: input.sackCount,
      reference: delivery.reference ?? `Livraison fournisseur #${delivery.id}`,
      tenantId,
    })

    if (input.paymentStatus !== 'paid') {
      const remaining = totalAmount - input.paidNow
      if (remaining > 0) {
        const dueDate = new Date()
        dueDate.setDate(dueDate.getDate() + input.dueInDays)
        await tx.insert(supplierPayables).values({
          supplierId: input.supplierId,
          deliveryId: delivery.id,
          amount: remaining,
          dueDate: dueDate.toISOString(),
          status: 'pending',
          tenantId,
        })
      }
    }

    return delivery
  })

  // Best-effort: check whether this delivery crosses a discount-tier threshold and, if so, grant it.
  // Done after the transaction commits (so the delivery is visible), and never allowed to fail the
  // delivery itself — a discount-check glitch shouldn't block recording a real stock reception.
  try {
    await checkAndGrantSupplierCycle(tenantId, input.supplierId)
  } catch (error) {
    console.error('checkAndGrantSupplierCycle failed after recordSupplierDelivery', error)
  }

  return delivery
}

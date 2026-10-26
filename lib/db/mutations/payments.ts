import { and, asc, eq, ne } from 'drizzle-orm'
import { withTenant } from '../tenant'
import { payments, paymentMethod, receivables, supplierPayables, supplierPayments } from '../schema'
import { recordAutoCashMovement } from './cash-accounts'

export async function recordPayment(tenantId: number, input: { clientId: number; amount: number; method: (typeof paymentMethod)[number]; storeId: number }) {
  await withTenant(tenantId, async (tx) => {
    await tx.insert(payments).values({
      clientId: input.clientId,
      saleId: null,
      storeId: input.storeId,
      amount: input.amount,
      method: input.method,
      tenantId,
    })

    let remaining = input.amount
    const openReceivables = await tx
      .select()
      .from(receivables)
      .where(and(eq(receivables.clientId, input.clientId), ne(receivables.status, 'paid'), eq(receivables.tenantId, tenantId)))
      .orderBy(asc(receivables.dueDate))

    for (const receivable of openReceivables) {
      if (remaining <= 0) break
      if (remaining >= receivable.amount) {
        remaining -= receivable.amount
        await tx.update(receivables).set({ amount: 0, status: 'paid' }).where(and(eq(receivables.id, receivable.id), eq(receivables.tenantId, tenantId)))
      } else {
        await tx
          .update(receivables)
          .set({ amount: receivable.amount - remaining })
          .where(and(eq(receivables.id, receivable.id), eq(receivables.tenantId, tenantId)))
        remaining = 0
      }
    }
  })

  await recordAutoCashMovement(tenantId, {
    direction: 'in',
    amount: input.amount,
    storeId: input.storeId,
    category: 'Encaissement client',
  })
}

export async function recordSupplierPayment(tenantId: number, input: { supplierId: number; amount: number; method: (typeof paymentMethod)[number] }) {
  await withTenant(tenantId, async (tx) => {
    await tx.insert(supplierPayments).values({
      supplierId: input.supplierId,
      amount: input.amount,
      method: input.method,
      tenantId,
    })

    let remaining = input.amount
    const openPayables = await tx
      .select()
      .from(supplierPayables)
      .where(and(eq(supplierPayables.supplierId, input.supplierId), ne(supplierPayables.status, 'paid'), eq(supplierPayables.tenantId, tenantId)))
      .orderBy(asc(supplierPayables.dueDate))

    for (const payable of openPayables) {
      if (remaining <= 0) break
      if (remaining >= payable.amount) {
        remaining -= payable.amount
        await tx.update(supplierPayables).set({ amount: 0, status: 'paid' }).where(and(eq(supplierPayables.id, payable.id), eq(supplierPayables.tenantId, tenantId)))
      } else {
        await tx
          .update(supplierPayables)
          .set({ amount: payable.amount - remaining })
          .where(and(eq(supplierPayables.id, payable.id), eq(supplierPayables.tenantId, tenantId)))
        remaining = 0
      }
    }
  })

  // Suppliers aren't store-scoped, so this resolves to a global cash account of the matching
  // type if one exists, else any account of that type — see recordAutoCashMovement.
  await recordAutoCashMovement(tenantId, {
    direction: 'out',
    amount: input.amount,
    category: 'Paiement fournisseur',
  })
}

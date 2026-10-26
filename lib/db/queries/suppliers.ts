import { eq } from 'drizzle-orm'
import { withTenant } from '../tenant'
import { supplierDeliveries, supplierPayables, supplierPayments, suppliers } from '../schema'
import { formatFcfa } from '@/lib/format'

export async function getSuppliersOverview(tenantId: number) {
  return withTenant(tenantId, async (tx) => {
    const supplierRows = await tx.select().from(suppliers).where(eq(suppliers.tenantId, tenantId))
    const payableRows = await tx
      .select({ supplierId: supplierPayables.supplierId, amount: supplierPayables.amount, status: supplierPayables.status })
      .from(supplierPayables)
      .where(eq(supplierPayables.tenantId, tenantId))
    const paymentRows = await tx
      .select({ supplierId: supplierPayments.supplierId, amount: supplierPayments.amount })
      .from(supplierPayments)
      .where(eq(supplierPayments.tenantId, tenantId))
    const deliveryRows = await tx
      .select({ supplierId: supplierDeliveries.supplierId, sackCount: supplierDeliveries.sackCount, createdAt: supplierDeliveries.createdAt })
      .from(supplierDeliveries)
      .where(eq(supplierDeliveries.tenantId, tenantId))

    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const result = supplierRows.map((supplier) => {
      const owedRows = payableRows.filter((row) => row.supplierId === supplier.id && row.status !== 'paid')
      const owed = owedRows.reduce((sum, row) => sum + row.amount, 0)
      const overdue = owedRows.some((row) => row.status === 'overdue')
      const totalPaid = paymentRows.filter((row) => row.supplierId === supplier.id).reduce((sum, row) => sum + row.amount, 0)
      const deliveriesThisMonth = deliveryRows.filter((row) => row.supplierId === supplier.id && row.createdAt >= monthStart.toISOString())
      const sacksThisMonth = deliveriesThisMonth.reduce((sum, row) => sum + row.sackCount, 0)
      const status: 'ok' | 'pending' | 'overdue' = owed === 0 ? 'ok' : overdue ? 'overdue' : 'pending'
      return {
        id: supplier.id,
        name: supplier.name,
        phone: supplier.phone ?? '—',
        owed: formatFcfa(owed),
        owedRaw: owed,
        totalPaid: formatFcfa(totalPaid),
        sacksThisMonth,
        status,
      }
    })

    const totalOwed = result.reduce((sum, supplier) => sum + supplier.owedRaw, 0)
    const deliveriesThisMonthCount = deliveryRows.filter((row) => row.createdAt >= monthStart.toISOString()).length

    return {
      suppliers: result.map(({ owedRaw, ...supplier }) => supplier),
      summary: {
        totalSuppliers: result.length,
        totalOwed: formatFcfa(totalOwed),
        deliveriesThisMonth: deliveriesThisMonthCount,
      },
    }
  })
}

export async function getSupplierOptions(tenantId: number) {
  return withTenant(tenantId, async (tx) => {
    return tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.tenantId, tenantId)).orderBy(suppliers.name)
  })
}

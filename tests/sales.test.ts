import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withTenant } from '@/lib/db/tenant'
import { appSettings, clients, payments, products, receivables, saleItems, sales, stockLevels, stockMovements, stores } from '@/lib/db/schema'
import { createSale } from '@/lib/db/mutations/sales'
import { getAppSettings, updateAppSettings } from '@/lib/db/mutations/settings'
import { primeTenantBranding } from '@/lib/settings-cache'
import { getTestTenantId } from './test-tenant'

// A dedicated tenant for the test suite, never tenant 1 (the demo tenant shown to prospects) —
// see tests/test-tenant.ts for why.
const tenantId = await getTestTenantId()
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let storeId: number
let clientId: number
let sackProductId: number
let tonneProductId: number
const saleIds: number[] = []

async function stockOf(productId: number) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({ quantity: stockLevels.quantity }).from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.storeId, storeId)))
    return row?.quantity ?? 0
  })
}

beforeAll(async () => {
  await withTenant(tenantId, async (tx) => {
    const [store] = await tx.insert(stores).values({ tenantId, name: `Magasin ${runId}`, city: 'Test' }).returning()
    storeId = store.id
    const [client] = await tx.insert(clients).values({ tenantId, name: `Client ${runId}`, storeId }).returning()
    clientId = client.id

    const [sackProduct] = await tx
      .insert(products)
      .values({ tenantId, name: `Farine sac ${runId}`, sku: `SKU-SACK-${runId}`, category: 'Test', unitPrice: 1000, costPrice: 800 })
      .returning()
    sackProductId = sackProduct.id

    const [tonneProduct] = await tx
      .insert(products)
      .values({ tenantId, name: `Farine tonne ${runId}`, sku: `SKU-TONNE-${runId}`, category: 'Test', unitPrice: 1000, costPrice: 800, sackWeightKg: 25 })
      .returning()
    tonneProductId = tonneProduct.id

    await tx.insert(stockLevels).values([
      { tenantId, productId: sackProductId, storeId, quantity: 100 },
      { tenantId, productId: tonneProductId, storeId, quantity: 100 },
    ])
  })
})

afterAll(async () => {
  await withTenant(tenantId, async (tx) => {
    for (const saleId of saleIds) {
      await tx.delete(receivables).where(eq(receivables.saleId, saleId))
      await tx.delete(payments).where(eq(payments.saleId, saleId))
      await tx.delete(saleItems).where(eq(saleItems.saleId, saleId))
      await tx.delete(sales).where(eq(sales.id, saleId))
    }
    await tx.delete(stockMovements).where(eq(stockMovements.storeId, storeId))
    await tx.delete(stockLevels).where(eq(stockLevels.storeId, storeId))
    await tx.delete(products).where(eq(products.id, sackProductId))
    await tx.delete(products).where(eq(products.id, tonneProductId))
    await tx.delete(clients).where(eq(clients.id, clientId))
    await tx.delete(stores).where(eq(stores.id, storeId))
  })
})

describe('createSale', () => {
  it('deducts stock for a paid sale', async () => {
    const before = await stockOf(sackProductId)
    const sale = await createSale(tenantId, {
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 15,
      items: [{ productId: sackProductId, quantity: 10 }],
    })
    saleIds.push(sale.id)
    expect(await stockOf(sackProductId)).toBe(before - 10)
  })

  it('records both a payment and the correct receivable remainder for a partial sale', async () => {
    const sale = await createSale(tenantId, {
      storeId,
      clientId,
      paymentStatus: 'partial',
      paidNow: 4000,
      dueInDays: 15,
      items: [{ productId: sackProductId, quantity: 10 }], // total = 10,000
    })
    saleIds.push(sale.id)

    const { payment, receivable } = await withTenant(tenantId, async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.saleId, sale.id))
      const [receivable] = await tx.select().from(receivables).where(eq(receivables.saleId, sale.id))
      return { payment, receivable }
    })
    expect(payment?.amount).toBe(4000)
    expect(receivable?.amount).toBe(6000)
  })

  it('rejects a sale when stock is insufficient and leaves stock unchanged', async () => {
    const before = await stockOf(sackProductId)
    await expect(
      createSale(tenantId, {
        storeId,
        clientId: null,
        paymentStatus: 'paid',
        paidNow: 0,
        dueInDays: 15,
        items: [{ productId: sackProductId, quantity: before + 1000 }],
      }),
    ).rejects.toThrow(/stock insuffisant/i)
    expect(await stockOf(sackProductId)).toBe(before)
  })

  it('converts a tonne-unit sale to the correct sack count', async () => {
    const before = await stockOf(tonneProductId)
    const sale = await createSale(tenantId, {
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 15,
      items: [{ productId: tonneProductId, quantity: 0, unit: 'tonne', tonnage: 2.5 }], // 2.5t / 25kg = 100 sacks
    })
    saleIds.push(sale.id)

    const item = await withTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id))
      return row
    })
    expect(item.quantity).toBe(100)
    expect(item.unit).toBe('tonne')
    expect(item.tonnage).toBe(2.5)
    expect(await stockOf(tonneProductId)).toBe(before - 100)
  })

  it('rejects a tonne-unit sale for a product with no configured sack weight', async () => {
    await expect(
      createSale(tenantId, {
        storeId,
        clientId: null,
        paymentStatus: 'paid',
        paidNow: 0,
        dueInDays: 15,
        items: [{ productId: sackProductId, quantity: 0, unit: 'tonne', tonnage: 1 }],
      }),
    ).rejects.toThrow(/poids de sac/i)
  })
})

describe('createSale with count-mode unit conversion', () => {
  let cartonProductId: number
  let previousSettings: Awaited<ReturnType<typeof getAppSettings>>

  beforeAll(async () => {
    previousSettings = await getAppSettings(tenantId)
    await updateAppSettings(tenantId, {
      companyName: previousSettings?.companyName ?? 'Tenant de tests automatisés',
      companyShortName: previousSettings?.companyShortName ?? 'Tests',
      country: previousSettings?.country ?? 'Test',
      currency: previousSettings?.currency ?? 'XXX',
      companyAddress: previousSettings?.companyAddress,
      companyPhone: previousSettings?.companyPhone,
      companyEmail: previousSettings?.companyEmail,
      logoDataUrl: previousSettings?.logoDataUrl,
      unitBaseSingular: 'Pièce',
      unitBasePlural: 'Pièces',
      unitBulkSingular: 'Carton',
      unitBulkPlural: 'Cartons',
      unitConversionMode: 'count',
      unitBulkConversionFactor: null,
    })
    primeTenantBranding(tenantId, {
      companyName: previousSettings?.companyName ?? 'Tenant de tests automatisés',
      companyShortName: previousSettings?.companyShortName ?? 'Tests',
      country: previousSettings?.country ?? 'Test',
      currency: previousSettings?.currency ?? 'XXX',
      unitBaseSingular: 'Pièce',
      unitBasePlural: 'Pièces',
      unitBulkSingular: 'Carton',
      unitBulkPlural: 'Cartons',
      unitConversionMode: 'count',
      unitBulkConversionFactor: null,
    })

    await withTenant(tenantId, async (tx) => {
      // In count mode, sackWeightKg holds "base units per bulk unit" (pieces per carton), not a weight.
      const [cartonProduct] = await tx
        .insert(products)
        .values({ tenantId, name: `Savon carton ${runId}`, sku: `SKU-CARTON-${runId}`, category: 'Test', unitPrice: 1000, costPrice: 800, sackWeightKg: 12 })
        .returning()
      cartonProductId = cartonProduct.id
      await tx.insert(stockLevels).values({ tenantId, productId: cartonProductId, storeId, quantity: 100 })
    })
  })

  afterAll(async () => {
    // try/finally: a failure while deleting the product must not skip restoring this tenant's
    // appSettings — otherwise the shared test tenant is left in count mode for every later run.
    try {
      await withTenant(tenantId, async (tx) => {
        // The outer afterAll (which deletes sale_items/sales for every id in saleIds) hasn't run
        // yet at this point — it runs last, once the whole file's describes are done — so this
        // product's own sale_items row must be cleared here first or the FK RESTRICT blocks delete.
        await tx.delete(saleItems).where(eq(saleItems.productId, cartonProductId))
        await tx.delete(stockMovements).where(eq(stockMovements.productId, cartonProductId))
        await tx.delete(stockLevels).where(eq(stockLevels.productId, cartonProductId))
        await tx.delete(products).where(eq(products.id, cartonProductId))
      })
    } finally {
      await restoreSettings()
    }

    async function restoreSettings() {
      if (previousSettings) {
        await updateAppSettings(tenantId, {
          companyName: previousSettings.companyName,
          companyShortName: previousSettings.companyShortName,
          country: previousSettings.country,
          currency: previousSettings.currency,
          companyAddress: previousSettings.companyAddress,
          companyPhone: previousSettings.companyPhone,
          companyEmail: previousSettings.companyEmail,
          logoDataUrl: previousSettings.logoDataUrl,
          unitBaseSingular: previousSettings.unitBaseSingular,
          unitBasePlural: previousSettings.unitBasePlural,
          unitBulkSingular: previousSettings.unitBulkSingular,
          unitBulkPlural: previousSettings.unitBulkPlural,
          unitConversionMode: previousSettings.unitConversionMode,
          unitBulkConversionFactor: previousSettings.unitBulkConversionFactor,
        })
      } else {
        await withTenant(tenantId, async (tx) => {
          await tx.delete(appSettings).where(eq(appSettings.tenantId, tenantId))
        })
      }
      primeTenantBranding(tenantId, previousSettings ?? { companyName: 'Tenant de tests automatisés', companyShortName: 'Tests', country: 'Test', currency: 'XXX' })
    }
  })

  it('multiplies the bulk quantity by the per-unit count instead of dividing by a weight', async () => {
    const before = await stockOf(cartonProductId)
    const sale = await createSale(tenantId, {
      storeId,
      clientId: null,
      paymentStatus: 'paid',
      paidNow: 0,
      dueInDays: 15,
      items: [{ productId: cartonProductId, quantity: 0, unit: 'tonne', tonnage: 3 }], // 3 cartons * 12 pieces = 36
    })
    saleIds.push(sale.id)

    const item = await withTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id))
      return row
    })
    expect(item.quantity).toBe(36)
    expect(await stockOf(cartonProductId)).toBe(before - 36)
  })
})

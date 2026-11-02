import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { withTenant } from '@/lib/db/tenant'
import { products, stockLevels, stores } from '@/lib/db/schema'
import { bulkImportProducts } from '@/lib/db/mutations/products'
import { getTestTenantId } from './test-tenant'

const tenantId = await getTestTenantId()
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let storeId: number
let otherStoreId: number
const productIds: number[] = []

async function makeStore(suffix: string) {
  return withTenant(tenantId, async (tx) => {
    const [store] = await tx.insert(stores).values({ tenantId, name: `Magasin ${suffix} ${runId}`, city: 'Test' }).returning()
    return store.id
  })
}

afterAll(async () => {
  await withTenant(tenantId, async (tx) => {
    for (const id of productIds) {
      await tx.delete(stockLevels).where(and(eq(stockLevels.productId, id), eq(stockLevels.tenantId, tenantId)))
      await tx.delete(products).where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
    }
    await tx.delete(stores).where(eq(stores.id, storeId))
    await tx.delete(stores).where(eq(stores.id, otherStoreId))
  })
})

describe('bulkImportProducts', () => {
  it('imports valid rows, generating a SKU when none is given, and sets initial stock on the target store only', async () => {
    storeId = await makeStore('A')
    otherStoreId = await makeStore('B')

    const result = await bulkImportProducts(tenantId, {
      storeId,
      rows: [
        { sku: `BAR-${runId}`, name: `Savon import ${runId}`, category: 'Test', unitPrice: 5000, costPrice: 3000, initialQuantity: 10 },
        { name: `Produit sans code ${runId}`, category: 'Test', unitPrice: 2000, costPrice: 1000 },
      ],
    })

    expect(result.imported).toBe(2)
    expect(result.skipped).toEqual([])

    const rows = await withTenant(tenantId, (tx) => tx.select().from(products).where(eq(products.tenantId, tenantId)))
    const withBarcode = rows.find((r) => r.sku === `BAR-${runId}`)
    const autoSku = rows.find((r) => r.name === `Produit sans code ${runId}`)
    expect(withBarcode).toBeTruthy()
    expect(autoSku?.sku).toBeTruthy()
    productIds.push(withBarcode!.id, autoSku!.id)

    const targetStock = await withTenant(tenantId, async (tx) => {
      const [row] = await tx.select({ quantity: stockLevels.quantity }).from(stockLevels).where(and(eq(stockLevels.productId, withBarcode!.id), eq(stockLevels.storeId, storeId)))
      return row?.quantity
    })
    const otherStock = await withTenant(tenantId, async (tx) => {
      const [row] = await tx.select({ quantity: stockLevels.quantity }).from(stockLevels).where(and(eq(stockLevels.productId, withBarcode!.id), eq(stockLevels.storeId, otherStoreId)))
      return row?.quantity
    })
    expect(targetStock).toBe(10)
    expect(otherStock).toBe(0)
  })

  it('skips a row whose barcode is already used by another product, without failing the rest of the batch', async () => {
    const existingSku = `DUP-${runId}`
    const [existing] = await withTenant(tenantId, (tx) =>
      tx.insert(products).values({ tenantId, name: `Déjà là ${runId}`, sku: existingSku, category: 'Test', unitPrice: 1000, costPrice: 500 }).returning(),
    )
    productIds.push(existing.id)

    const result = await bulkImportProducts(tenantId, {
      storeId,
      rows: [
        { sku: existingSku, name: `Doublon ${runId}`, category: 'Test', unitPrice: 1000, costPrice: 500 },
        { name: `Ligne suivante OK ${runId}`, category: 'Test', unitPrice: 1500, costPrice: 700 },
      ],
    })

    expect(result.imported).toBe(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toMatch(/déjà utilisé/i)

    const [ok] = await withTenant(tenantId, (tx) => tx.select().from(products).where(and(eq(products.tenantId, tenantId), eq(products.name, `Ligne suivante OK ${runId}`))))
    expect(ok).toBeTruthy()
    productIds.push(ok.id)
  })

  it('skips rows with missing or invalid fields, reporting the reason per row', async () => {
    const result = await bulkImportProducts(tenantId, {
      storeId,
      rows: [
        { name: '', category: 'Test', unitPrice: 1000, costPrice: 500 },
        { name: `Prix invalide ${runId}`, category: 'Test', unitPrice: 0, costPrice: 500 },
      ],
    })

    expect(result.imported).toBe(0)
    expect(result.skipped).toHaveLength(2)
    expect(result.skipped[0].reason).toMatch(/nom manquant/i)
    expect(result.skipped[1].reason).toMatch(/prix de vente invalide/i)
  })

  it('rejects an import targeting a store outside the tenant', async () => {
    await expect(bulkImportProducts(tenantId, { storeId: -1, rows: [{ name: 'X', category: 'Test', unitPrice: 1, costPrice: 1 }] })).rejects.toThrow(/magasin/i)
  })

  it('imports a row with a custom unit, and falls back to the default unit when none is given', async () => {
    const result = await bulkImportProducts(tenantId, {
      storeId,
      rows: [
        { name: `Eau import ${runId}`, category: 'Test', unitPrice: 500, costPrice: 300, unitSingular: 'Bouteille', unitPlural: 'Bouteilles' },
        { name: `Sans unité ${runId}`, category: 'Test', unitPrice: 1000, costPrice: 500 },
      ],
    })

    expect(result.imported).toBe(2)
    const rows = await withTenant(tenantId, (tx) => tx.select().from(products).where(eq(products.tenantId, tenantId)))
    const bottle = rows.find((r) => r.name === `Eau import ${runId}`)
    const defaultUnit = rows.find((r) => r.name === `Sans unité ${runId}`)
    expect(bottle).toBeTruthy()
    expect(defaultUnit).toBeTruthy()
    productIds.push(bottle!.id, defaultUnit!.id)

    expect(bottle?.unitSingular).toBe('Bouteille')
    expect(bottle?.unitPlural).toBe('Bouteilles')
    expect(defaultUnit?.unitSingular).toBe('Sac')
    expect(defaultUnit?.unitPlural).toBe('Sacs')
  })
})

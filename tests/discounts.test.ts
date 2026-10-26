import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withTenant } from '@/lib/db/tenant'
import { clients, discountApplications, discountScales, discountTiers, products, sales, stores, supplierDeliveries, suppliers } from '@/lib/db/schema'
import { checkAndGrantSupplierCycle, computeDiscount, getSupplierCycleProgress, setDiscountTiers } from '@/lib/db/mutations/discounts'
import { getTestTenantId } from './test-tenant'

// Integration test — runs against the real Postgres DB (no separate test DB available). Every
// fixture is suffixed with a unique run id and cleaned up in afterAll by id, so it never touches
// or depends on any other row in the shared tables. A dedicated tenant, never tenant 1 (the demo
// tenant shown to prospects) — see tests/test-tenant.ts.
const tenantId = await getTestTenantId()
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let supplierId: number
let storeId: number
let productId: number

async function deliver(sackCount: number) {
  await withTenant(tenantId, (tx) =>
    tx.insert(supplierDeliveries).values({ tenantId, supplierId, storeId, productId, sackCount, totalAmount: 0 }),
  )
}

beforeAll(async () => {
  await withTenant(tenantId, async (tx) => {
    const [supplier] = await tx.insert(suppliers).values({ tenantId, name: `Fournisseur ${runId}` }).returning()
    supplierId = supplier.id
    const [store] = await tx.insert(stores).values({ tenantId, name: `Magasin ${runId}`, city: 'Test' }).returning()
    storeId = store.id
    const [product] = await tx
      .insert(products)
      .values({ tenantId, name: `Produit ${runId}`, sku: `SKU-${runId}`, category: 'Test', unitPrice: 100, costPrice: 80 })
      .returning()
    productId = product.id
  })
  // Two tiers: crossing either grants a discount on the FULL accumulated sack count (cliff), and the
  // highest tier reached wins when both are crossed at once.
  await setDiscountTiers(tenantId, 'supplier', supplierId, [
    { thresholdSacks: 1000, discountPerSack: 2000 },
    { thresholdSacks: 2000, discountPerSack: 5000 },
  ])
})

afterAll(async () => {
  await withTenant(tenantId, async (tx) => {
    const [scale] = await tx
      .select()
      .from(discountScales)
      .where(and(eq(discountScales.partyType, 'supplier'), eq(discountScales.partyId, supplierId)))
    if (scale) {
      await tx.delete(discountApplications).where(eq(discountApplications.scaleId, scale.id))
      await tx.delete(discountTiers).where(eq(discountTiers.scaleId, scale.id))
      await tx.delete(discountScales).where(eq(discountScales.id, scale.id))
    }
    await tx.delete(supplierDeliveries).where(eq(supplierDeliveries.supplierId, supplierId))
    await tx.delete(suppliers).where(eq(suppliers.id, supplierId))
    await tx.delete(products).where(eq(products.id, productId))
    await tx.delete(stores).where(eq(stores.id, storeId))
  })
})

describe('supplier discount cycle', () => {
  it('grants nothing before the first tier is reached', async () => {
    await deliver(500)
    const grant = await checkAndGrantSupplierCycle(tenantId, supplierId)
    expect(grant).toBeNull()

    const progress = await getSupplierCycleProgress(tenantId, supplierId)
    expect(progress.sackCount).toBe(500)
    expect(progress.nextTier).toEqual({ thresholdSacks: 1000, sacksRemaining: 500 })
  })

  it('grants a cliff discount on the full accumulated count once a tier is crossed, then resets the cycle', async () => {
    await deliver(600) // 500 + 600 = 1100, crosses the 1000-sack tier

    const grant = await checkAndGrantSupplierCycle(tenantId, supplierId)
    expect(grant).not.toBeNull()
    expect(grant?.tierReached).toBe(1000)
    expect(grant?.sackCount).toBe(1100)
    expect(grant?.discountPerSack).toBe(2000)
    expect(grant?.totalDiscount).toBe(1100 * 2000)

    const progress = await getSupplierCycleProgress(tenantId, supplierId)
    expect(progress.sackCount).toBe(0)
  })

  it('starts counting from zero after a grant and reaches the highest tier on the full new total', async () => {
    await deliver(2000)

    const grant = await checkAndGrantSupplierCycle(tenantId, supplierId)
    expect(grant).not.toBeNull()
    expect(grant?.tierReached).toBe(2000)
    expect(grant?.sackCount).toBe(2000)
    expect(grant?.discountPerSack).toBe(5000)
    expect(grant?.totalDiscount).toBe(2000 * 5000)
  })
})

describe('concurrency safety', () => {
  it('creates exactly one discount_scales row when two calls race to create it for the same party', async () => {
    const supplier = await withTenant(tenantId, async (tx) => {
      const [row] = await tx.insert(suppliers).values({ tenantId, name: `Fournisseur concurrence ${runId}` }).returning()
      return row
    })
    try {
      // Every call here hits a brand-new supplier with no existing scale — this is exactly the race
      // getOrCreateScale() guards against with onConflictDoNothing + the unique index.
      await Promise.all(
        Array.from({ length: 10 }, () => setDiscountTiers(tenantId, 'supplier', supplier.id, [{ thresholdSacks: 500, discountPerSack: 1000 }])),
      )

      const scaleRows = await withTenant(tenantId, (tx) =>
        tx.select().from(discountScales).where(and(eq(discountScales.partyType, 'supplier'), eq(discountScales.partyId, supplier.id))),
      )
      expect(scaleRows).toHaveLength(1)
    } finally {
      await withTenant(tenantId, async (tx) => {
        const [scale] = await tx
          .select()
          .from(discountScales)
          .where(and(eq(discountScales.partyType, 'supplier'), eq(discountScales.partyId, supplier.id)))
        if (scale) {
          await tx.delete(discountTiers).where(eq(discountTiers.scaleId, scale.id))
          await tx.delete(discountScales).where(eq(discountScales.id, scale.id))
        }
        await tx.delete(suppliers).where(eq(suppliers.id, supplier.id))
      })
    }
  })

  it('creates exactly one discount_applications row when two computeDiscount() calls race for the same client/period', async () => {
    const client = await withTenant(tenantId, async (tx) => {
      const [row] = await tx.insert(clients).values({ tenantId, name: `Client concurrence ${runId}` }).returning()
      return row
    })
    try {
      await Promise.all(Array.from({ length: 10 }, () => computeDiscount(tenantId, 'client', client.id)))

      await withTenant(tenantId, async (tx) => {
        const [scale] = await tx
          .select()
          .from(discountScales)
          .where(and(eq(discountScales.partyType, 'client'), eq(discountScales.partyId, client.id)))
        expect(scale).toBeTruthy()

        const applicationRows = await tx.select().from(discountApplications).where(eq(discountApplications.scaleId, scale.id))
        expect(applicationRows).toHaveLength(1)

        await tx.delete(discountApplications).where(eq(discountApplications.scaleId, scale.id))
        await tx.delete(discountScales).where(eq(discountScales.id, scale.id))
      })
    } finally {
      await withTenant(tenantId, async (tx) => {
        await tx.delete(sales).where(eq(sales.clientId, client.id))
        await tx.delete(clients).where(eq(clients.id, client.id))
      })
    }
  })
})

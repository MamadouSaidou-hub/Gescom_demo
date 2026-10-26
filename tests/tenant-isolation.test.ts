import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withTenant } from '@/lib/db/tenant'
import { clients, products, sales, stores } from '@/lib/db/schema'

// Proves RLS + the application-level tenantId filters actually isolate two tenants from each
// other — not just that the code compiles. Creates two throwaway tenants with deliberately
// identically-named rows, then checks that querying as tenant A never returns tenant B's rows,
// and vice versa. Uses the owner connection (DATABASE_URL) only to create/destroy the tenants
// themselves — everything else goes through withTenant(), exactly like the app does.
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
let tenantAId: number
let tenantBId: number
let ownerPool: Pool

beforeAll(async () => {
  ownerPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const client = await ownerPool.connect()
  try {
    const { rows } = await client.query(
      `INSERT INTO tenants (name, slug, country, currency, status, created_at)
       VALUES ($1, $2, 'Test', 'XOF', 'active', $3), ($4, $5, 'Test', 'XOF', 'active', $3)
       RETURNING id`,
      [`Tenant A ${runId}`, `tenant-a-${runId}`, new Date().toISOString(), `Tenant B ${runId}`, `tenant-b-${runId}`],
    )
    tenantAId = rows[0].id
    tenantBId = rows[1].id
  } finally {
    client.release()
  }
})

afterAll(async () => {
  // Business rows reference tenants via a plain FK (no ON DELETE CASCADE, on purpose — offboarding
  // a real tenant should never be an accidental one-statement data wipe), so clean those up first.
  for (const id of [tenantAId, tenantBId]) {
    await withTenant(id, async (tx) => {
      await tx.delete(sales).where(eq(sales.tenantId, id))
      await tx.delete(clients).where(eq(clients.tenantId, id))
      await tx.delete(products).where(eq(products.tenantId, id))
      await tx.delete(stores).where(eq(stores.tenantId, id))
    })
  }

  const client = await ownerPool.connect()
  try {
    await client.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantAId, tenantBId]])
  } finally {
    client.release()
    await ownerPool.end()
  }
})

describe('tenant isolation', () => {
  it('a product created for tenant A is invisible when querying as tenant B, and vice versa', async () => {
    const sku = `SKU-ISO-${runId}`

    await withTenant(tenantAId, (tx) =>
      tx.insert(products).values({ tenantId: tenantAId, name: 'Produit isolation', sku, category: 'Test', unitPrice: 100, costPrice: 50 }),
    )
    await withTenant(tenantBId, (tx) =>
      tx.insert(products).values({ tenantId: tenantBId, name: 'Produit isolation', sku, category: 'Test', unitPrice: 999, costPrice: 999 }),
    )

    const asA = await withTenant(tenantAId, (tx) => tx.select().from(products).where(eq(products.sku, sku)))
    const asB = await withTenant(tenantBId, (tx) => tx.select().from(products).where(eq(products.sku, sku)))

    expect(asA).toHaveLength(1)
    expect(asA[0].tenantId).toBe(tenantAId)
    expect(asA[0].unitPrice).toBe(100)

    expect(asB).toHaveLength(1)
    expect(asB[0].tenantId).toBe(tenantBId)
    expect(asB[0].unitPrice).toBe(999)
  })

  it('a client created for tenant A never shows up in tenant B\'s client list', async () => {
    const name = `Client isolation ${runId}`

    await withTenant(tenantAId, (tx) => tx.insert(clients).values({ tenantId: tenantAId, name }))

    const asB = await withTenant(tenantBId, (tx) => tx.select().from(clients).where(eq(clients.name, name)))
    expect(asB).toHaveLength(0)

    const asA = await withTenant(tenantAId, (tx) => tx.select().from(clients).where(eq(clients.name, name)))
    expect(asA).toHaveLength(1)
  })

  it('a sale created for tenant A is invisible to tenant B even though sale references are globally unique', async () => {
    const storeA = await withTenant(tenantAId, async (tx) => {
      const [row] = await tx.insert(stores).values({ tenantId: tenantAId, name: `Magasin A ${runId}`, city: 'Test' }).returning()
      return row
    })

    const sale = await withTenant(tenantAId, async (tx) => {
      const [row] = await tx
        .insert(sales)
        .values({ tenantId: tenantAId, reference: `ISO-${runId}`, storeId: storeA.id, totalAmount: 1000, costAmount: 800, paymentStatus: 'paid' })
        .returning()
      return row
    })

    const asB = await withTenant(tenantBId, (tx) => tx.select().from(sales).where(eq(sales.id, sale.id)))
    expect(asB).toHaveLength(0)

    const asA = await withTenant(tenantAId, (tx) => tx.select().from(sales).where(eq(sales.id, sale.id)))
    expect(asA).toHaveLength(1)
  })

  it('querying with no tenant set (raw db, outside withTenant) returns zero rows — RLS fails closed', async () => {
    const { db } = await import('@/lib/db/client')
    const sku = `SKU-ISO-${runId}`
    const rows = await db.select().from(products).where(eq(products.sku, sku))
    expect(rows).toHaveLength(0)
  })
})

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { tenants } from '@/lib/db/schema'

// Dedicated tenant for the automated test suite — NEVER tenant 1 (the seeded demo tenant, which
// gets renamed/rebranded and shown to real prospects). Running `npm test` against tenant 1 once
// leaked nine fake sales and their stores/clients/products straight into a live client demo.
// Idempotent: reuses the same row across runs instead of creating a new tenant every time.
const TEST_TENANT_SLUG = 'automated-tests'

let cachedId: number | null = null

export async function getTestTenantId(): Promise<number> {
  if (cachedId) return cachedId

  const [existing] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, TEST_TENANT_SLUG))
  if (existing) {
    cachedId = existing.id
    return existing.id
  }

  const [created] = await db
    .insert(tenants)
    .values({
      name: 'Tenant de tests automatisés — ne jamais afficher à un client',
      slug: TEST_TENANT_SLUG,
      country: 'Test',
      currency: 'XXX',
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    .returning({ id: tenants.id })

  cachedId = created.id
  return created.id
}

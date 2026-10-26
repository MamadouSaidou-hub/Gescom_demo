import { eq } from 'drizzle-orm'
import { withTenant } from '../tenant'
import { products, stockLevels, stores } from '../schema'

export async function createStore(tenantId: number, input: { name: string; city: string }) {
  return withTenant(tenantId, async (tx) => {
    const [store] = await tx.insert(stores).values({ name: input.name, city: input.city, tenantId }).returning()

    const productRows = await tx.select({ id: products.id }).from(products).where(eq(products.tenantId, tenantId))
    if (productRows.length > 0) {
      await tx.insert(stockLevels).values(productRows.map((product) => ({ productId: product.id, storeId: store.id, quantity: 0, tenantId })))
    }

    return store
  })
}

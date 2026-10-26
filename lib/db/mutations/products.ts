import { and, eq, like } from 'drizzle-orm'
import { withTenant } from '../tenant'
import { products, stockLevels, stockMovements, stores } from '../schema'
import { getQuantity } from './shared'

const STOPWORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'un', 'une', 'au', 'aux'])

function slugify(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
}

/** Derives a short, readable base like "FARBLE" from "Farine de blé T55 50kg" — the first 3
 * letters of each of the first two meaningful words — then disambiguates with a numeric suffix so
 * near-identical product names (different sizes of the same item) still get distinct SKUs. */
export async function generateUniqueSku(tenantId: number, name: string): Promise<string> {
  const words = name
    .split(/\s+/)
    .map(slugify)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word.toLowerCase()))

  const base = (words.slice(0, 2).map((word) => word.slice(0, 3)).join('') || 'ART').slice(0, 10)

  return withTenant(tenantId, async (tx) => {
    const existing = await tx
      .select({ sku: products.sku })
      .from(products)
      .where(and(like(products.sku, `${base}-%`), eq(products.tenantId, tenantId)))
    const taken = new Set(existing.map((row) => row.sku))

    for (let n = 1; n <= taken.size + 1; n++) {
      const candidate = `${base}-${String(n).padStart(2, '0')}`
      if (!taken.has(candidate)) return candidate
    }
    // Unreachable in practice (loop covers one more than the number of existing matches), but keeps
    // the return type honest if it ever is.
    return `${base}-${Date.now()}`
  })
}

export async function createProduct(
  tenantId: number,
  input: {
    name: string
    sku?: string
    category: string
    unitPrice: number
    costPrice: number
    reorderThreshold: number
    storeId: number
    initialQuantity: number
    sackWeightKg?: number | null
  },
) {
  const sku = input.sku?.trim() || (await generateUniqueSku(tenantId, input.name))

  return withTenant(tenantId, async (tx) => {
    const [product] = await tx
      .insert(products)
      .values({
        name: input.name,
        sku,
        category: input.category,
        unitPrice: input.unitPrice,
        costPrice: input.costPrice,
        reorderThreshold: input.reorderThreshold,
        sackWeightKg: input.sackWeightKg ?? null,
        tenantId,
      })
      .returning()

    const storeRows = await tx.select({ id: stores.id }).from(stores).where(eq(stores.tenantId, tenantId))
    await tx.insert(stockLevels).values(
      storeRows.map((store) => ({
        productId: product.id,
        storeId: store.id,
        quantity: store.id === input.storeId ? input.initialQuantity : 0,
        tenantId,
      })),
    )

    if (input.initialQuantity > 0) {
      await tx.insert(stockMovements).values({
        type: 'reception',
        productId: product.id,
        storeId: input.storeId,
        quantity: input.initialQuantity,
        reference: 'Création article',
        tenantId,
      })
    }

    return product
  })
}

export async function updateProduct(
  tenantId: number,
  id: number,
  input: { unitPrice?: number; costPrice?: number; reorderThreshold?: number },
) {
  return withTenant(tenantId, async (tx) => {
    const [product] = await tx
      .update(products)
      .set(input)
      .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
      .returning()
    return product
  })
}

export async function addStockReception(tenantId: number, input: { productId: number; storeId: number; quantity: number; reference?: string }) {
  return withTenant(tenantId, async (tx) => {
    const currentQuantity = await getQuantity(tx, tenantId, input.productId, input.storeId)

    await tx
      .update(stockLevels)
      .set({ quantity: currentQuantity + input.quantity })
      .where(and(eq(stockLevels.productId, input.productId), eq(stockLevels.storeId, input.storeId), eq(stockLevels.tenantId, tenantId)))

    await tx.insert(stockMovements).values({
      type: 'reception',
      productId: input.productId,
      storeId: input.storeId,
      quantity: input.quantity,
      reference: input.reference ?? null,
      tenantId,
    })
  })
}

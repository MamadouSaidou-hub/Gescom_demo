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

function deriveSkuBase(name: string): string {
  const words = name
    .split(/\s+/)
    .map(slugify)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word.toLowerCase()))
  return (words.slice(0, 2).map((word) => word.slice(0, 3)).join('') || 'ART').slice(0, 10)
}

/** Picks the next free `${base}-NN` suffix against a set of SKUs already known to be taken — no DB
 * access, so it can be called once per row in a bulk import without a round-trip per row, as long
 * as the caller keeps `taken` updated with every SKU it hands out. */
function nextAvailableSku(base: string, taken: Set<string>): string {
  for (let n = 1; n <= taken.size + 1; n++) {
    const candidate = `${base}-${String(n).padStart(2, '0')}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

/** Derives a short, readable base like "FARBLE" from "Farine de blé T55 50kg" — the first 3
 * letters of each of the first two meaningful words — then disambiguates with a numeric suffix so
 * near-identical product names (different sizes of the same item) still get distinct SKUs. */
export async function generateUniqueSku(tenantId: number, name: string): Promise<string> {
  const base = deriveSkuBase(name)

  return withTenant(tenantId, async (tx) => {
    const existing = await tx
      .select({ sku: products.sku })
      .from(products)
      .where(and(like(products.sku, `${base}-%`), eq(products.tenantId, tenantId)))
    return nextAvailableSku(base, new Set(existing.map((row) => row.sku)))
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

export type BulkImportRow = {
  sku?: string
  name: string
  category: string
  unitPrice: number
  costPrice: number
  initialQuantity?: number
  reorderThreshold?: number
}

/** Imports many products in one transaction, isolating failures per row instead of letting one bad
 * row (missing field, barcode already in use) abort the whole batch — a client uploading a
 * hand-filled spreadsheet needs to know exactly which lines to fix, not just "import failed". */
export async function bulkImportProducts(tenantId: number, input: { storeId: number; rows: BulkImportRow[] }) {
  return withTenant(tenantId, async (tx) => {
    const storeRows = await tx.select({ id: stores.id }).from(stores).where(eq(stores.tenantId, tenantId))
    if (!storeRows.some((store) => store.id === input.storeId)) {
      throw new Error('Magasin cible invalide.')
    }

    const existingSkus = new Set(
      (await tx.select({ sku: products.sku }).from(products).where(eq(products.tenantId, tenantId))).map((row) => row.sku),
    )

    const skipped: { row: number; reason: string }[] = []
    let importedCount = 0

    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i]
      const rowNumber = i + 2 // header is row 1 in the uploaded file

      try {
        const name = row.name?.trim()
        const category = row.category?.trim()
        if (!name) throw new Error('Nom manquant.')
        if (!category) throw new Error('Catégorie manquante.')
        if (!Number.isFinite(row.unitPrice) || row.unitPrice <= 0) throw new Error('Prix de vente invalide.')
        if (!Number.isFinite(row.costPrice) || row.costPrice < 0) throw new Error("Prix d'achat invalide.")

        let sku = row.sku?.trim()
        if (sku) {
          if (existingSkus.has(sku)) throw new Error(`Code-barres déjà utilisé par un autre produit : ${sku}.`)
        } else {
          sku = nextAvailableSku(deriveSkuBase(name), existingSkus)
        }
        existingSkus.add(sku)

        const initialQuantity = row.initialQuantity && row.initialQuantity > 0 ? row.initialQuantity : 0

        // A failed INSERT poisons the whole surrounding transaction in Postgres — every later
        // statement would fail with "current transaction is aborted" even though we `catch` the
        // JS error. Wrapping each row in its own nested transaction (a SAVEPOINT under the hood)
        // means a row failure only rolls back that row, leaving the rest of the batch unaffected.
        await tx.transaction(async (rowTx) => {
          const [product] = await rowTx
            .insert(products)
            .values({
              tenantId,
              name,
              sku,
              category,
              unitPrice: row.unitPrice,
              costPrice: row.costPrice,
              reorderThreshold: row.reorderThreshold ?? 10,
            })
            .returning()

          await rowTx.insert(stockLevels).values(
            storeRows.map((store) => ({
              productId: product.id,
              storeId: store.id,
              quantity: store.id === input.storeId ? initialQuantity : 0,
              tenantId,
            })),
          )

          if (initialQuantity > 0) {
            await rowTx.insert(stockMovements).values({
              type: 'reception',
              productId: product.id,
              storeId: input.storeId,
              quantity: initialQuantity,
              reference: 'Import catalogue',
              tenantId,
            })
          }
        })

        importedCount += 1
      } catch (error) {
        skipped.push({ row: rowNumber, reason: error instanceof Error ? error.message : 'Erreur inconnue.' })
      }
    }

    return { imported: importedCount, skipped }
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

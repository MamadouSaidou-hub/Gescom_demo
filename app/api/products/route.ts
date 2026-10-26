import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/db/tenant'
import { products } from '@/lib/db/schema'
import { createProduct } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, hasPermission } from '@/lib/session'
import { eq } from 'drizzle-orm'

export async function GET() {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const rows = await withTenant(ctx.tenantId, async (tx) =>
    tx.select().from(products).where(eq(products.tenantId, ctx.tenantId)).orderBy(products.name),
  )
  return NextResponse.json({ products: rows })
}

export async function POST(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!hasPermission(ctx, 'products')) return NextResponse.json({ error: 'Permission "Produits & prix" requise.' }, { status: 403 })

  const body = await request.json()
  const name = String(body.name ?? '').trim()
  const sku = body.sku ? String(body.sku).trim() : undefined
  const category = String(body.category ?? '').trim()
  const unitPrice = Number(body.unitPrice)
  const costPrice = Number(body.costPrice)
  const storeId = Number(body.storeId)

  if (!name || !category || !Number.isFinite(unitPrice) || !Number.isFinite(costPrice) || !Number.isFinite(storeId)) {
    return NextResponse.json({ error: 'Champs invalides ou manquants.' }, { status: 400 })
  }

  try {
    const product = await createProduct(ctx.tenantId, {
      name,
      sku,
      category,
      unitPrice,
      costPrice,
      reorderThreshold: Number(body.reorderThreshold ?? 10),
      storeId,
      initialQuantity: Number(body.initialQuantity ?? 0),
      sackWeightKg: body.sackWeightKg !== undefined && body.sackWeightKg !== null && body.sackWeightKg !== '' ? Number(body.sackWeightKg) : null,
    })
    return NextResponse.json({ product }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

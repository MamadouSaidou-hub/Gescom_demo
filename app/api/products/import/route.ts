import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { bulkImportProducts, type BulkImportRow } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, hasPermission } from '@/lib/session'

// Matches a column by several possible header spellings (accents/case vary depending on how the
// client typed their spreadsheet headers) — read the first one found for each row.
function pick(row: Record<string, unknown>, ...headers: string[]): string {
  for (const key of Object.keys(row)) {
    const normalized = key.trim().toLowerCase()
    if (headers.some((h) => h.toLowerCase() === normalized)) {
      return String(row[key] ?? '').trim()
    }
  }
  return ''
}

function toNumber(value: string): number {
  // Tolerates "1 500" (space thousands separator) and "1500,50" (comma decimal) in addition to
  // plain "1500.50" — common when a value was typed or pasted from a French-locale spreadsheet.
  const cleaned = value.replace(/\s/g, '').replace(',', '.')
  return Number(cleaned)
}

export async function POST(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!hasPermission(ctx, 'products')) return NextResponse.json({ error: 'Permission "Produits & prix" requise.' }, { status: 403 })

  const formData = await request.formData()
  const file = formData.get('file')
  const storeId = Number(formData.get('storeId'))

  if (!(file instanceof File) || !Number.isFinite(storeId)) {
    return NextResponse.json({ error: 'Fichier ou magasin manquant.' }, { status: 400 })
  }
  // A product catalog has no business being a huge file — this also keeps a malicious upload from
  // tying up the server parsing an enormous spreadsheet.
  if (file.size > 5_000_000) {
    return NextResponse.json({ error: 'Fichier trop volumineux (max 5 Mo).' }, { status: 400 })
  }

  let rawRows: Record<string, unknown>[]
  try {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  } catch {
    return NextResponse.json({ error: 'Fichier illisible — vérifiez que c’est bien un .csv ou .xlsx.' }, { status: 400 })
  }

  if (rawRows.length === 0) {
    return NextResponse.json({ error: 'Le fichier ne contient aucune ligne de produit.' }, { status: 400 })
  }

  const rows: BulkImportRow[] = rawRows.map((raw) => {
    const unitSingular = pick(raw, 'unité', 'unite', 'unité de mesure', 'unite de mesure') || undefined
    const unitPluralRaw = pick(raw, 'unité pluriel', 'unite pluriel', 'unité (pluriel)') || undefined
    return {
      sku: pick(raw, 'code-barres', 'code barres', 'sku') || undefined,
      name: pick(raw, 'nom', 'nom du produit', 'produit'),
      category: pick(raw, 'catégorie', 'categorie'),
      unitPrice: toNumber(pick(raw, 'prix de vente', 'prix vente')),
      costPrice: toNumber(pick(raw, "prix d'achat", 'prix dachat', 'prix achat')),
      initialQuantity: pick(raw, 'stock initial', 'stock') ? toNumber(pick(raw, 'stock initial', 'stock')) : undefined,
      reorderThreshold: pick(raw, "seuil d'alerte", 'seuil dalerte', 'seuil') ? toNumber(pick(raw, "seuil d'alerte", 'seuil dalerte', 'seuil')) : undefined,
      unitSingular,
      // No explicit plural column given: a simple "+s" is a reasonable default for most French
      // nouns ("Bouteille" -> "Bouteilles") and the admin can always override it later.
      unitPlural: unitPluralRaw ?? (unitSingular ? (unitSingular.endsWith('s') ? unitSingular : `${unitSingular}s`) : undefined),
    }
  })

  try {
    const result = await bulkImportProducts(ctx.tenantId, { storeId, rows })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

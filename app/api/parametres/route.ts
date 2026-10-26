import { NextRequest, NextResponse } from 'next/server'
import { getAppSettings, updateAppSettings } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'
import { primeTenantBranding } from '@/lib/settings-cache'

export async function GET() {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const settings = await getAppSettings(ctx.tenantId)
  return NextResponse.json({ settings })
}

export async function PATCH(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const body = await request.json()
  const companyName = String(body.companyName ?? '').trim()
  const companyShortName = String(body.companyShortName ?? '').trim()
  const country = String(body.country ?? '').trim()
  const currency = String(body.currency ?? '').trim().toUpperCase()
  const companyAddress = body.companyAddress ? String(body.companyAddress).trim() : null
  const companyPhone = body.companyPhone ? String(body.companyPhone).trim() : null
  const companyEmail = body.companyEmail ? String(body.companyEmail).trim() : null
  const logoDataUrl = body.logoDataUrl ? String(body.logoDataUrl) : null

  if (!companyName || !companyShortName || !country || !currency) {
    return NextResponse.json({ error: 'Tous les champs sont requis.' }, { status: 400 })
  }
  if (currency.length > 6) {
    return NextResponse.json({ error: 'Le code devise doit être court (ex. GNF, XOF, DJF).' }, { status: 400 })
  }
  // ~1MB data: URL ceiling — a logo has no business being larger than this, and app_settings is a
  // plain table row, not built for large blobs.
  if (logoDataUrl && logoDataUrl.length > 1_400_000) {
    return NextResponse.json({ error: 'Logo trop volumineux (max ~1 Mo). Choisissez une image plus légère.' }, { status: 400 })
  }
  if (logoDataUrl && !logoDataUrl.startsWith('data:image/')) {
    return NextResponse.json({ error: 'Format de logo invalide.' }, { status: 400 })
  }

  try {
    const settings = await updateAppSettings(ctx.tenantId, { companyName, companyShortName, country, currency, companyAddress, companyPhone, companyEmail, logoDataUrl })
    primeTenantBranding(ctx.tenantId, settings)
    return NextResponse.json({ settings })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

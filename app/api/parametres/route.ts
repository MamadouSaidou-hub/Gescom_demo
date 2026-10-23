import { NextRequest, NextResponse } from 'next/server'
import { getAppSettings, updateAppSettings } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, isAdmin } from '@/lib/session'
import { primeSettingsCache } from '@/lib/settings-cache'

export async function GET() {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const settings = await getAppSettings()
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

  if (!companyName || !companyShortName || !country || !currency) {
    return NextResponse.json({ error: 'Tous les champs sont requis.' }, { status: 400 })
  }
  if (currency.length > 6) {
    return NextResponse.json({ error: 'Le code devise doit être court (ex. GNF, XOF, DJF).' }, { status: 400 })
  }

  try {
    const settings = await updateAppSettings({ companyName, companyShortName, country, currency })
    primeSettingsCache(settings)
    return NextResponse.json({ settings })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

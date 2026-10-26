import { NextRequest, NextResponse } from 'next/server'
import { createTenant, listTenants } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { recordAuditEvent } from '@/lib/audit'
import { getSessionContext, isPlatformAdmin } from '@/lib/session'

export async function GET() {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isPlatformAdmin(ctx)) return NextResponse.json({ error: 'Réservé à l’équipe plateforme.' }, { status: 403 })

  const tenants = await listTenants()
  return NextResponse.json({ tenants })
}

export async function POST(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isPlatformAdmin(ctx)) return NextResponse.json({ error: 'Réservé à l’équipe plateforme.' }, { status: 403 })

  const body = await request.json()
  const name = String(body.name ?? '').trim()
  const slug = String(body.slug ?? '').trim().toLowerCase()
  const country = String(body.country ?? '').trim()
  const currency = String(body.currency ?? '').trim().toUpperCase()
  const adminEmail = String(body.adminEmail ?? '').trim()
  const adminPassword = String(body.adminPassword ?? '')
  const adminName = String(body.adminName ?? '').trim()
  const storeName = String(body.storeName ?? '').trim()
  const storeCity = String(body.storeCity ?? '').trim()

  if (!name || !slug || !country || !currency || !adminEmail || !adminName || !storeName || !storeCity) {
    return NextResponse.json({ error: 'Tous les champs sont requis.' }, { status: 400 })
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: 'Le slug ne peut contenir que des lettres minuscules, chiffres et tirets.' }, { status: 400 })
  }
  if (adminPassword.length < 8) {
    return NextResponse.json({ error: 'Le mot de passe admin doit faire au moins 8 caractères.' }, { status: 400 })
  }

  try {
    const { tenant } = await createTenant({ name, slug, country, currency, adminEmail, adminPassword, adminName, storeName, storeCity })
    await recordAuditEvent({
      actor: ctx,
      action: 'tenant.created',
      targetType: 'tenant',
      targetId: String(tenant.id),
      // Platform-level event: belongs to no single tenant's own trail.
      tenantId: null,
      // Note the absence of adminPassword — never put credentials in the trail.
      payload: { name, slug, country, currency, adminEmail, storeName, storeCity },
    })
    return NextResponse.json({ tenant }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('tenants_slug_key')) return NextResponse.json({ error: 'Ce slug est déjà utilisé par un autre tenant.' }, { status: 400 })
    if (message.includes('user_email_unique') || message.includes('"user_email')) {
      return NextResponse.json({ error: 'Cet e-mail admin est déjà utilisé par un compte existant.' }, { status: 400 })
    }
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

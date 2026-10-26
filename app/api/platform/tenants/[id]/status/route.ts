import { NextRequest, NextResponse } from 'next/server'
import { getTenant, setTenantStatus } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { recordAuditEvent } from '@/lib/audit'
import { getSessionContext, invalidateTenantStatus, isPlatformAdmin } from '@/lib/session'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isPlatformAdmin(ctx)) return NextResponse.json({ error: 'Réservé à l’équipe plateforme.' }, { status: 403 })

  const { id } = await params
  const tenantId = Number(id)
  if (!Number.isFinite(tenantId)) {
    return NextResponse.json({ error: 'Identifiant de client invalide.' }, { status: 400 })
  }

  // Suspending the tenant you belong to would immediately lock you out of the platform console
  // itself (getSessionContext returns null for a suspended tenant) — with no way back in.
  if (tenantId === ctx.tenantId) {
    return NextResponse.json({ error: 'Vous ne pouvez pas suspendre votre propre espace.' }, { status: 400 })
  }

  const body = await request.json()
  const status = body.status === 'suspended' ? 'suspended' : 'active'

  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Client introuvable.' }, { status: 404 })
  if (tenant.status === status) {
    return NextResponse.json({ tenant })
  }

  try {
    const updated = await setTenantStatus(tenantId, status)
    invalidateTenantStatus(tenantId)
    await recordAuditEvent({
      actor: ctx,
      action: status === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated',
      targetType: 'tenant',
      targetId: String(tenantId),
      tenantId: null,
      payload: { name: tenant.name, slug: tenant.slug, previousStatus: tenant.status, newStatus: status },
    })
    return NextResponse.json({ tenant: updated })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

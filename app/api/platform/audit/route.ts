import { NextResponse } from 'next/server'
import { countAuditEvents, listAuditEvents, verifyAuditChain } from '@/lib/audit'
import { getSessionContext, isPlatformAdmin } from '@/lib/session'

export async function GET() {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isPlatformAdmin(ctx)) return NextResponse.json({ error: 'Réservé à l’équipe plateforme.' }, { status: 403 })

  const [events, total, verification] = await Promise.all([listAuditEvents(200), countAuditEvents(), verifyAuditChain()])

  return NextResponse.json({ events, total, verification })
}

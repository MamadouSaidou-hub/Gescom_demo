import { NextRequest, NextResponse } from 'next/server'
import { getReportsOverview } from '@/lib/db/queries'
import { parsePeriodLabel } from '@/lib/period'
import { getSessionContext, hasPermission } from '@/lib/session'

export async function GET(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!hasPermission(ctx, 'reports')) return NextResponse.json({ error: 'Permission "Rapports & marges" requise.' }, { status: 403 })

  const period = parsePeriodLabel(request.nextUrl.searchParams.get('period'), 'month')
  const data = await getReportsOverview(ctx.tenantId, period)
  return NextResponse.json(data)
}

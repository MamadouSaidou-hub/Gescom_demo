import { NextRequest, NextResponse } from 'next/server'
import { getReportsOverview } from '@/lib/db/queries'
import { parsePeriodLabel } from '@/lib/period'
import { getSessionContext, hasPermission } from '@/lib/session'

export async function GET(request: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!hasPermission(ctx, 'reports')) return NextResponse.json({ error: 'Permission "Rapports & marges" requise.' }, { status: 403 })

  const searchParams = request.nextUrl.searchParams
  const period = parsePeriodLabel(searchParams.get('period'), 'month')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const custom = period === 'custom' && from && to ? { from, to } : undefined
  const data = await getReportsOverview(ctx.tenantId, period, custom)
  return NextResponse.json(data)
}

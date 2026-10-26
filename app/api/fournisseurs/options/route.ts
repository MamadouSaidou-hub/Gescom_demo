import { NextResponse } from 'next/server'
import { getSupplierOptions } from '@/lib/db/queries'
import { getSessionContext, hasPermission } from '@/lib/session'

export async function GET() {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!hasPermission(ctx, 'suppliers')) return NextResponse.json({ error: 'Permission "Fournisseurs" requise.' }, { status: 403 })

  const suppliers = await getSupplierOptions(ctx.tenantId)
  return NextResponse.json({ suppliers })
}

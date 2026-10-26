import { NextResponse } from 'next/server'
import { setDefaultCashAccount } from '@/lib/db/mutations'
import { toApiErrorMessage } from '@/lib/api-error'
import { getSessionContext, hasPermission } from '@/lib/session'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!hasPermission(ctx, 'treasury')) return NextResponse.json({ error: 'Permission "Caisse & Trésorerie" requise.' }, { status: 403 })

  const { id } = await params
  const accountId = Number(id)
  if (!Number.isFinite(accountId)) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 })
  }

  try {
    const account = await setDefaultCashAccount(ctx.tenantId, accountId)
    return NextResponse.json({ account })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

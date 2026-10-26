import { NextResponse } from 'next/server'
import { getClientOptions } from '@/lib/db/queries'
import { getSessionContext } from '@/lib/session'

export async function GET() {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const clients = await getClientOptions(ctx.tenantId)
  return NextResponse.json({ clients })
}

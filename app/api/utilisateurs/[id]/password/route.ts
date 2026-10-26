import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { user } from '@/lib/db/auth-schema'
import { toApiErrorMessage } from '@/lib/api-error'
import { recordAuditEvent } from '@/lib/audit'
import { getSessionContext, isAdmin } from '@/lib/session'

// No self-service "forgot password" email flow yet (no email provider configured) — instead the
// tenant admin resets a teammate's password directly, which also covers the "forgot password"
// case for accounts the admin themselves created.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params

  // `user` has no RLS — this is the only thing stopping an admin from resetting a password on an
  // account in a different tenant.
  const [target] = await db.select({ tenantId: user.tenantId, email: user.email }).from(user).where(eq(user.id, id))
  if (!target || target.tenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'Utilisateur introuvable.' }, { status: 404 })
  }

  const body = await request.json()
  const newPassword = String(body.newPassword ?? '')
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'Le mot de passe doit faire au moins 8 caractères.' }, { status: 400 })
  }

  try {
    await auth.api.setUserPassword({ body: { userId: id, newPassword }, headers: await headers() })
    await recordAuditEvent({
      actor: ctx,
      action: 'user.password_reset',
      targetType: 'user',
      targetId: id,
      // Never the password itself — only that it happened and for whom.
      payload: { email: target.email },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

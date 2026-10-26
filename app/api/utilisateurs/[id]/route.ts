import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { user } from '@/lib/db/auth-schema'
import { toApiErrorMessage } from '@/lib/api-error'
import { recordAuditEvent } from '@/lib/audit'
import { getSessionContext, isAdmin } from '@/lib/session'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params

  // `user` has no RLS, so this is the only thing stopping an admin from modifying an account in
  // a different tenant (e.g. promoting it to admin, reassigning its store).
  const [target] = await db
    .select({ tenantId: user.tenantId, email: user.email, role: user.role, storeId: user.storeId })
    .from(user)
    .where(eq(user.id, id))
  if (!target || target.tenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'Utilisateur introuvable.' }, { status: 404 })
  }

  const body = await request.json()
  const role = body.role === 'admin' ? 'admin' : 'gestionnaire'
  const storeId = body.storeId ? Number(body.storeId) : null

  if (role === 'gestionnaire' && !storeId) {
    return NextResponse.json({ error: 'Un magasin est requis pour un gestionnaire.' }, { status: 400 })
  }
  if (id === ctx.userId && role !== 'admin') {
    return NextResponse.json({ error: 'Vous ne pouvez pas retirer votre propre rôle administrateur.' }, { status: 400 })
  }

  try {
    // better-auth's admin plugin owns the `role` column (keeps its session cache consistent); `storeId`
    // is a plain app-level field it doesn't know about, so it's updated directly — same pattern as
    // lib/db/seed-admin.ts.
    await auth.api.setRole({ body: { userId: id, role: role as 'admin' }, headers: await headers() })
    await db.update(user).set({ storeId: role === 'admin' ? null : storeId }).where(eq(user.id, id))
    await recordAuditEvent({
      actor: ctx,
      action: 'user.role_changed',
      targetType: 'user',
      targetId: id,
      payload: {
        email: target.email,
        previousRole: target.role,
        newRole: role,
        previousStoreId: target.storeId,
        newStoreId: role === 'admin' ? null : storeId,
      },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext()
  if (!ctx) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  if (!isAdmin(ctx)) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const { id } = await params
  if (id === ctx.userId) {
    return NextResponse.json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' }, { status: 400 })
  }

  const [target] = await db
    .select({ tenantId: user.tenantId, email: user.email, role: user.role, name: user.name })
    .from(user)
    .where(eq(user.id, id))
  if (!target || target.tenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'Utilisateur introuvable.' }, { status: 404 })
  }

  try {
    await auth.api.removeUser({ body: { userId: id }, headers: await headers() })
    await recordAuditEvent({
      actor: ctx,
      action: 'user.deleted',
      targetType: 'user',
      targetId: id,
      // The row is gone after this, so the trail keeps who it was — this is the only place that
      // record survives.
      payload: { email: target.email, name: target.name, role: target.role },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: toApiErrorMessage(error) }, { status: 400 })
  }
}

import { asc, desc, sql } from 'drizzle-orm'
import type { AuditAction } from './audit-labels'
import { db } from './db/client'
import { auditLog } from './db/schema'
import type { SessionContext } from './session'

export type { AuditAction } from './audit-labels'

type RecordInput = {
  actor: Pick<SessionContext, 'userId' | 'email' | 'tenantId'>
  action: AuditAction
  targetType: 'user' | 'tenant'
  targetId: string
  /** Business context only — never tokens, passwords or other secrets. */
  payload?: Record<string, unknown>
  /** Null for platform-level events that belong to no single tenant (e.g. creating one). */
  tenantId?: number | null
}

/**
 * Appends one entry. `prevHash`/`entryHash` are filled in by the database trigger, not here —
 * this function cannot produce a valid-looking but unchained row even if it wanted to.
 *
 * Never throws into the caller's path: an audit write failing must not roll back or block the
 * business action the user just performed (a failed role change is worse than a missing log line).
 * It is logged loudly instead, and the gap stays visible in chain verification.
 */
export async function recordAuditEvent(input: RecordInput): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorId: input.actor.userId,
      actorEmail: input.actor.email,
      tenantId: input.tenantId === undefined ? input.actor.tenantId : input.tenantId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      payload: input.payload ?? {},
    })
  } catch (error) {
    console.error('[audit] failed to record event', { action: input.action, targetId: input.targetId }, error)
  }
}

export async function listAuditEvents(limit = 200) {
  return db
    .select({
      id: auditLog.id,
      actorEmail: auditLog.actorEmail,
      tenantId: auditLog.tenantId,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      payload: auditLog.payload,
      entryHash: auditLog.entryHash,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(limit)
}

export type ChainVerification = {
  ok: boolean
  entriesChecked: number
  /** Id of the first entry whose stored hash doesn't match a recomputation, if any. */
  brokenAtId: number | null
  reason: string | null
}

/**
 * Recomputes the whole chain with the same formula the database trigger uses and compares it to
 * what's stored. Catches both a rewritten entry (hash no longer matches its content) and a removed
 * one (the next entry's prevHash no longer matches its predecessor).
 */
export async function verifyAuditChain(): Promise<ChainVerification> {
  const rows = await db
    .select({
      id: auditLog.id,
      actorId: auditLog.actorId,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      prevHash: auditLog.prevHash,
      entryHash: auditLog.entryHash,
      // Recompute with Postgres itself so the formula and the text/jsonb/timestamp rendering match
      // the trigger exactly — doing it in JS would require byte-identical canonicalization and
      // would drift the moment either side changed.
      recomputed: sql<string>`encode(digest(${auditLog.prevHash} || '|' || ${auditLog.actorId} || '|' || ${auditLog.action} || '|' || ${auditLog.targetType} || '|' || ${auditLog.targetId} || '|' || ${auditLog.payload}::text || '|' || ${auditLog.createdAt}::text, 'sha256'), 'hex')`,
    })
    .from(auditLog)
    .orderBy(asc(auditLog.id))

  let expectedPrev = 'genesis'
  for (const row of rows) {
    if (row.prevHash !== expectedPrev) {
      return {
        ok: false,
        entriesChecked: rows.length,
        brokenAtId: row.id,
        reason: `Le maillon précédent ne correspond pas (entrée #${row.id}) — une entrée a probablement été supprimée.`,
      }
    }
    if (row.recomputed !== row.entryHash) {
      return {
        ok: false,
        entriesChecked: rows.length,
        brokenAtId: row.id,
        reason: `Le contenu de l’entrée #${row.id} ne correspond plus à son empreinte — elle a été modifiée.`,
      }
    }
    expectedPrev = row.entryHash
  }

  return { ok: true, entriesChecked: rows.length, brokenAtId: null, reason: null }
}

export async function countAuditEvents() {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(auditLog)
  return row?.count ?? 0
}

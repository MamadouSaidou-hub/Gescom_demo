import { eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { auditLog } from '@/lib/db/schema'
import { recordAuditEvent, verifyAuditChain } from '@/lib/audit'
import { getTestTenantId } from './test-tenant'

// Integration test against the real database — the guarantees being tested (hash chaining, and
// append-only enforced by Postgres privileges) live in the database, not in application code, so
// mocking would test nothing of value.
const runId = `audit-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const testTenantId = await getTestTenantId()
const actor = { userId: `test-${runId}`, email: `${runId}@test.local`, tenantId: testTenantId }

afterAll(async () => {
  // app_runtime deliberately has no DELETE on audit_log, so cleanup needs the owner connection —
  // which is itself the point of the test. Keeping the rows would otherwise poison later runs.
  const { Pool } = await import('pg')
  const { readFileSync } = await import('fs')
  const envText = readFileSync('.env.local', 'utf8')
  const ownerUrl = envText.match(/^DATABASE_URL=(.*)$/m)![1].trim()
  const pool = new Pool({ connectionString: ownerUrl, ssl: { rejectUnauthorized: false } })
  await pool.query(`DELETE FROM audit_log WHERE actor_id = $1`, [actor.userId])
  await pool.end()
})

describe('audit trail', () => {
  it('chains each entry to the previous one', async () => {
    await recordAuditEvent({ actor, action: 'user.created', targetType: 'user', targetId: `${runId}-a`, payload: { step: 1 } })
    await recordAuditEvent({ actor, action: 'user.role_changed', targetType: 'user', targetId: `${runId}-b`, payload: { step: 2 } })

    const rows = await db
      .select({ id: auditLog.id, prevHash: auditLog.prevHash, entryHash: auditLog.entryHash })
      .from(auditLog)
      .where(eq(auditLog.actorId, actor.userId))
      .orderBy(auditLog.id)

    expect(rows).toHaveLength(2)
    expect(rows[0].entryHash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[1].prevHash).toBe(rows[0].entryHash)
  })

  it('reports the chain as intact', async () => {
    const result = await verifyAuditChain()
    expect(result.ok).toBe(true)
    expect(result.brokenAtId).toBeNull()
  })

  it('refuses to let the application rewrite or delete an entry', async () => {
    const [row] = await db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.actorId, actor.userId)).limit(1)
    expect(row).toBeTruthy()

    // Drizzle wraps the driver error, so the Postgres message lives on `cause`, not the top level.
    const rejectionReason = async (promise: Promise<unknown>) => {
      try {
        await promise
        return null
      } catch (error) {
        const cause = (error as { cause?: { message?: string } }).cause
        return cause?.message ?? (error as Error).message
      }
    }

    // Raw SQL rather than db.update()/db.delete() so this tests the Postgres privilege, not a
    // TypeScript-level restriction that an attacker with code execution would simply bypass.
    expect(await rejectionReason(db.execute(sql`update audit_log set action = 'tampered' where id = ${row.id}`))).toMatch(/permission denied/i)
    expect(await rejectionReason(db.execute(sql`delete from audit_log where id = ${row.id}`))).toMatch(/permission denied/i)
  })

  it('never stores a password, even when one was part of the action', async () => {
    await recordAuditEvent({
      actor,
      action: 'tenant.created',
      targetType: 'tenant',
      targetId: `${runId}-t`,
      tenantId: null,
      payload: { name: 'Client test', adminEmail: 'x@y.z' },
    })
    const rows = await db.select({ payload: auditLog.payload }).from(auditLog).where(eq(auditLog.actorId, actor.userId))
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toMatch(/password/i)
  })
})

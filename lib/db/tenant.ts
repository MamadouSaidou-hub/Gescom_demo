import { sql } from 'drizzle-orm'
import { db } from './client'

export type TenantTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Runs `fn` inside a transaction with Postgres session var `app.tenant_id` set via
 * `set_config(..., true)` (transaction-scoped, not SET LOCAL — avoids leaking across pooled
 * connections since the setting never outlives this transaction). RLS policies read this var;
 * every query must go through the `tx` passed to `fn`, never the module-level `db`.
 */
export async function withTenant<T>(tenantId: number, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${String(tenantId)}, true)`)
    return fn(tx)
  })
}

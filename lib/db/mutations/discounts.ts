import { and, eq, gt, gte, lt } from 'drizzle-orm'
import { withTenant, type TenantTx } from '../tenant'
import { discountApplications, discountScales, discountTiers, saleItems, sales, supplierDeliveries } from '../schema'

export type PartyType = 'client' | 'supplier'

export function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function periodRange(period: string) {
  const [year, month] = period.split('-').map(Number)
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 1)
  return { start, end }
}

async function getOrCreateScale(tx: TenantTx, tenantId: number, partyType: PartyType, partyId: number) {
  const [existing] = await tx
    .select()
    .from(discountScales)
    .where(and(eq(discountScales.partyType, partyType), eq(discountScales.partyId, partyId), eq(discountScales.tenantId, tenantId)))
  if (existing) return existing

  // Two concurrent calls can both reach here having seen no existing row (e.g. two supplier
  // deliveries recorded moments apart). `onConflictDoNothing` + the unique index on
  // (partyType, partyId) means only one insert actually lands; the loser falls back to reading the
  // winner's row instead of creating a duplicate scale.
  const [created] = await tx.insert(discountScales).values({ partyType, partyId, tenantId }).onConflictDoNothing().returning()
  if (created) return created

  const [afterConflict] = await tx
    .select()
    .from(discountScales)
    .where(and(eq(discountScales.partyType, partyType), eq(discountScales.partyId, partyId), eq(discountScales.tenantId, tenantId)))
  return afterConflict
}

async function sacksMovedInPeriod(tx: TenantTx, tenantId: number, partyType: PartyType, partyId: number, period: string) {
  const { start, end } = periodRange(period)

  if (partyType === 'client') {
    const rows = await tx
      .select({ quantity: saleItems.quantity })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .where(
        and(
          eq(sales.clientId, partyId),
          gte(sales.createdAt, start.toISOString()),
          lt(sales.createdAt, end.toISOString()),
          eq(saleItems.tenantId, tenantId),
        ),
      )
    return rows.reduce((sum, row) => sum + row.quantity, 0)
  }

  const rows = await tx
    .select({ sackCount: supplierDeliveries.sackCount })
    .from(supplierDeliveries)
    .where(
      and(
        eq(supplierDeliveries.supplierId, partyId),
        gte(supplierDeliveries.createdAt, start.toISOString()),
        lt(supplierDeliveries.createdAt, end.toISOString()),
        eq(supplierDeliveries.tenantId, tenantId),
      ),
    )
  return rows.reduce((sum, row) => sum + row.sackCount, 0)
}

export async function computeDiscount(tenantId: number, partyType: PartyType, partyId: number, period: string = currentPeriod()) {
  return withTenant(tenantId, async (tx) => {
    const scale = await getOrCreateScale(tx, tenantId, partyType, partyId)
    const tiers = await tx
      .select()
      .from(discountTiers)
      .where(and(eq(discountTiers.scaleId, scale.id), eq(discountTiers.tenantId, tenantId)))
      .orderBy(discountTiers.thresholdSacks)

    const sackCount = await sacksMovedInPeriod(tx, tenantId, partyType, partyId, period)

    const descendingTiers = [...tiers].sort((a, b) => b.thresholdSacks - a.thresholdSacks)
    const tierReached = descendingTiers.find((tier) => sackCount >= tier.thresholdSacks) ?? null
    const totalDiscount = tierReached ? sackCount * tierReached.discountPerSack : 0

    const nextTier = [...tiers].sort((a, b) => a.thresholdSacks - b.thresholdSacks).find((tier) => tier.thresholdSacks > sackCount) ?? null

    // Upsert instead of select-then-branch: two concurrent calls for the same client/period would
    // otherwise both see "no application yet" and both insert, creating a duplicate row. The unique
    // index on (scaleId, period) plus onConflictDoUpdate makes this atomic instead.
    await tx
      .insert(discountApplications)
      .values({ scaleId: scale.id, period, tierReached: tierReached?.thresholdSacks ?? null, sackCount, totalDiscount, tenantId })
      .onConflictDoUpdate({
        target: [discountApplications.scaleId, discountApplications.period],
        set: { tierReached: tierReached?.thresholdSacks ?? null, sackCount, totalDiscount },
      })

    return {
      scaleId: scale.id,
      period,
      sackCount,
      tierReached: tierReached?.thresholdSacks ?? null,
      discountPerSack: tierReached?.discountPerSack ?? 0,
      totalDiscount,
      nextTier: nextTier ? { thresholdSacks: nextTier.thresholdSacks, sacksRemaining: nextTier.thresholdSacks - sackCount } : null,
    }
  })
}

async function sacksSinceCycleStart(tx: TenantTx, tenantId: number, supplierId: number, cycleStartAt: string | null) {
  // Strict `>`, not `>=` — a defensive margin in case a delivery and a cycleStartAt reset ever land in
  // the same instant. An inclusive bound would re-count that delivery into the very next cycle it just
  // closed out.
  const rows = await tx
    .select({ sackCount: supplierDeliveries.sackCount })
    .from(supplierDeliveries)
    .where(
      and(
        eq(supplierDeliveries.supplierId, supplierId),
        eq(supplierDeliveries.tenantId, tenantId),
        cycleStartAt ? gt(supplierDeliveries.createdAt, cycleStartAt) : undefined,
      ),
    )
  return rows.reduce((sum, row) => sum + row.sackCount, 0)
}

/**
 * Read-only progress for a supplier's discount cycle — no calendar period, no side effects.
 * Sacks are counted since the last granted cycle (or since the scale was created, if none yet).
 */
export async function getSupplierCycleProgress(tenantId: number, supplierId: number) {
  return withTenant(tenantId, async (tx) => {
    const scale = await getOrCreateScale(tx, tenantId, 'supplier', supplierId)
    const tiers = await tx
      .select()
      .from(discountTiers)
      .where(and(eq(discountTiers.scaleId, scale.id), eq(discountTiers.tenantId, tenantId)))
      .orderBy(discountTiers.thresholdSacks)

    const sackCount = await sacksSinceCycleStart(tx, tenantId, supplierId, scale.cycleStartAt)
    const nextTier = [...tiers].sort((a, b) => a.thresholdSacks - b.thresholdSacks).find((tier) => tier.thresholdSacks > sackCount) ?? null

    return {
      scaleId: scale.id,
      sackCount,
      nextTier: nextTier ? { thresholdSacks: nextTier.thresholdSacks, sacksRemaining: nextTier.thresholdSacks - sackCount } : null,
    }
  })
}

/**
 * Checks whether the supplier has crossed the highest configured tier since the current cycle
 * started; if so, grants that tier's discount (recorded in discountApplications, keyed by the grant
 * date instead of a calendar period), resets the cycle to start over from now, and returns the grant.
 * Returns null if no tier has been reached yet — no write happens in that case.
 */
export async function checkAndGrantSupplierCycle(tenantId: number, supplierId: number) {
  return withTenant(tenantId, async (tx) => {
    const scale = await getOrCreateScale(tx, tenantId, 'supplier', supplierId)
    const tiers = await tx
      .select()
      .from(discountTiers)
      .where(and(eq(discountTiers.scaleId, scale.id), eq(discountTiers.tenantId, tenantId)))
      .orderBy(discountTiers.thresholdSacks)
    if (tiers.length === 0) return null

    const sackCount = await sacksSinceCycleStart(tx, tenantId, supplierId, scale.cycleStartAt)
    const descendingTiers = [...tiers].sort((a, b) => b.thresholdSacks - a.thresholdSacks)
    const tierReached = descendingTiers.find((tier) => sackCount >= tier.thresholdSacks)
    if (!tierReached) return null

    const totalDiscount = sackCount * tierReached.discountPerSack
    const nowIso = new Date().toISOString()
    // `cycleStartAt` must be stored in the exact same format as `supplierDeliveries.createdAt` (both are
    // `Date#toISOString()` now — see the shared `timestamps` helper in schema.ts) since they're compared
    // as plain strings in `sacksSinceCycleStart`. Reformatting either one independently is exactly how the
    // bgm-sqlite-timestamp-quirk bug happened before — don't reintroduce a second, diverging formatter.
    const cycleStartAt = nowIso

    await tx.insert(discountApplications).values({
      scaleId: scale.id,
      period: nowIso,
      tierReached: tierReached.thresholdSacks,
      sackCount,
      totalDiscount,
      tenantId,
    })
    await tx
      .update(discountScales)
      .set({ cycleStartAt })
      .where(and(eq(discountScales.id, scale.id), eq(discountScales.tenantId, tenantId)))

    return { scaleId: scale.id, sackCount, tierReached: tierReached.thresholdSacks, discountPerSack: tierReached.discountPerSack, totalDiscount, grantedAt: nowIso }
  })
}

export async function setDiscountTiers(tenantId: number, partyType: PartyType, partyId: number, tiers: { thresholdSacks: number; discountPerSack: number }[]) {
  return withTenant(tenantId, async (tx) => {
    const scale = await getOrCreateScale(tx, tenantId, partyType, partyId)
    await tx.delete(discountTiers).where(and(eq(discountTiers.scaleId, scale.id), eq(discountTiers.tenantId, tenantId)))
    if (tiers.length > 0) {
      await tx.insert(discountTiers).values(tiers.map((tier) => ({ scaleId: scale.id, thresholdSacks: tier.thresholdSacks, discountPerSack: tier.discountPerSack, tenantId })))
    }
    return scale
  })
}

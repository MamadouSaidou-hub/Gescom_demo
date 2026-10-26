import { and, desc, eq } from 'drizzle-orm'
import { withTenant } from '../tenant'
import { discountApplications, discountScales, discountTiers } from '../schema'
import { formatFcfa } from '@/lib/format'
import { computeDiscount, currentPeriod, getSupplierCycleProgress, type PartyType } from '../mutations/discounts'

export async function getDiscountScale(tenantId: number, partyType: PartyType, partyId: number) {
  // Client scales: monthly, recomputed (and upserted) live on every read — cheap and idempotent per period.
  // Supplier scales: no calendar period — read-only progress since the last granted cycle. Granting only
  // happens explicitly (a delivery crossing a tier, or the "Calculer" button), never as a GET side effect.
  const current =
    partyType === 'client'
      ? await (async () => {
          const live = await computeDiscount(tenantId, 'client', partyId, currentPeriod())
          return {
            period: live.period as string | null,
            sackCount: live.sackCount,
            tierReached: live.tierReached,
            discountPerSack: live.discountPerSack,
            totalDiscount: live.totalDiscount,
            totalDiscountFormatted: formatFcfa(live.totalDiscount),
            nextTier: live.nextTier,
          }
        })()
      : await (async () => {
          const progress = await getSupplierCycleProgress(tenantId, partyId)
          return {
            period: null as string | null,
            sackCount: progress.sackCount,
            tierReached: null,
            discountPerSack: 0,
            totalDiscount: 0,
            totalDiscountFormatted: formatFcfa(0),
            nextTier: progress.nextTier,
          }
        })()

  return withTenant(tenantId, async (tx) => {
    const [scale] = await tx
      .select()
      .from(discountScales)
      .where(and(eq(discountScales.partyType, partyType), eq(discountScales.partyId, partyId), eq(discountScales.tenantId, tenantId)))
    const tiers = scale
      ? await tx
          .select()
          .from(discountTiers)
          .where(and(eq(discountTiers.scaleId, scale.id), eq(discountTiers.tenantId, tenantId)))
          .orderBy(discountTiers.thresholdSacks)
      : []

    return {
      tiers: tiers.map((tier) => ({ id: tier.id, thresholdSacks: tier.thresholdSacks, discountPerSack: tier.discountPerSack })),
      current,
    }
  })
}

export async function getDiscountHistory(tenantId: number, partyType: PartyType, partyId: number) {
  return withTenant(tenantId, async (tx) => {
    const [scale] = await tx
      .select()
      .from(discountScales)
      .where(and(eq(discountScales.partyType, partyType), eq(discountScales.partyId, partyId), eq(discountScales.tenantId, tenantId)))
    if (!scale) return []

    const rows = await tx
      .select()
      .from(discountApplications)
      .where(and(eq(discountApplications.scaleId, scale.id), eq(discountApplications.tenantId, tenantId)))
      .orderBy(desc(discountApplications.period))

    return rows.map((row) => ({
      period: row.period,
      sackCount: row.sackCount,
      tierReached: row.tierReached,
      totalDiscount: row.totalDiscount,
      totalDiscountFormatted: formatFcfa(row.totalDiscount),
    }))
  })
}

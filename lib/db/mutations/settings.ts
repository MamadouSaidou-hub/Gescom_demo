import { eq } from 'drizzle-orm'
import { appSettings } from '../schema'
import { withTenant } from '../tenant'

export async function getAppSettings(tenantId: number) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(appSettings).where(eq(appSettings.tenantId, tenantId))
    return row ?? null
  })
}

export async function updateAppSettings(
  tenantId: number,
  input: {
    companyName: string
    companyShortName: string
    country: string
    currency: string
    companyAddress?: string | null
    companyPhone?: string | null
    companyEmail?: string | null
    logoDataUrl?: string | null
  },
) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .insert(appSettings)
      .values({ tenantId, ...input })
      .onConflictDoUpdate({ target: appSettings.tenantId, set: input })
      .returning()
    return row
  })
}

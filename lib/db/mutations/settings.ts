import { eq } from 'drizzle-orm'
import { db } from '../client'
import { appSettings } from '../schema'

export async function getAppSettings() {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, 1))
  return row ?? null
}

export async function updateAppSettings(input: { companyName: string; companyShortName: string; country: string; currency: string }) {
  const [row] = await db
    .insert(appSettings)
    .values({ id: 1, ...input })
    .onConflictDoUpdate({ target: appSettings.id, set: input })
    .returning()
  return row
}

import { getAppSettings } from './db/mutations'
import { businessConfig } from './business-config'
import { companyInfo } from './company-info'

// Short-lived in-memory cache so every request doesn't hit the database just to read branding —
// a Settings page edit shows up for the next request after this expires (or immediately, since
// saving also calls applySettings() directly).
const TTL_MS = 10_000
let lastLoadedAt = 0
const DEFAULT_LOGO_PATH = companyInfo.logoPath
const DEFAULT_ADDRESS = companyInfo.address
const DEFAULT_PHONE = companyInfo.phone
const DEFAULT_EMAIL = companyInfo.email

type LoadedSettings = {
  companyName: string
  companyShortName: string
  country: string
  currency: string
  companyAddress?: string | null
  companyPhone?: string | null
  companyEmail?: string | null
  logoDataUrl?: string | null
}

function applySettings(settings: LoadedSettings) {
  companyInfo.name = settings.companyName
  companyInfo.displayName = settings.companyName
  companyInfo.shortName = settings.companyShortName
  companyInfo.country = settings.country
  businessConfig.currency = settings.currency
  companyInfo.address = settings.companyAddress || DEFAULT_ADDRESS
  companyInfo.phone = settings.companyPhone || DEFAULT_PHONE
  companyInfo.email = settings.companyEmail || DEFAULT_EMAIL
  // Falls back to the static default logo file when no custom logo has been uploaded.
  companyInfo.logoPath = settings.logoDataUrl || DEFAULT_LOGO_PATH
  lastLoadedAt = Date.now()
}

/** Called once per request (from getSessionContext, the root layout, and the manifest route) so
 * every synchronous `businessConfig.currency` / `companyInfo.*` read downstream is fresh. */
export async function ensureSettingsLoaded() {
  if (Date.now() - lastLoadedAt < TTL_MS) return
  const settings = await getAppSettings()
  if (settings) applySettings(settings)
}

/** Called right after a successful save so the change is visible immediately, not after the TTL. */
export function primeSettingsCache(settings: LoadedSettings) {
  applySettings(settings)
}

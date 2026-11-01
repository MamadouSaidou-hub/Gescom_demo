import { createHash } from 'crypto'
import { getAppSettings } from './db/mutations'
import { businessConfig } from './business-config'
import { companyInfo } from './company-info'

// A short hash of the logo's own content (its data: URL, or its static path) — included as a
// `?v=` query param on every /api/logo URL so the browser treats a changed logo as a brand-new
// resource. Without this, every <img src="/api/logo"> consumer shares one fixed URL, and the
// browser's HTTP cache keeps serving the old bytes for up to Cache-Control's max-age (or longer,
// in practice, especially once installed as a PWA) — forcing a manual cache-clear to see an
// update. Changes if and only if the underlying logo changes; never needs a DB migration.
function hashLogo(logo: string): string {
  return createHash('sha1').update(logo).digest('hex').slice(0, 10)
}

// Per-tenant cache, keyed by tenantId — NOT a shared mutable singleton. A single mutated
// companyInfo/businessConfig object would leak one tenant's branding into another tenant's
// request if two different tenants' requests interleave on the same Node process (a real
// possibility: Next.js/Vercel can serve concurrent requests from one warm instance). Every
// consumer must call `getTenantBranding(tenantId)` and use the returned object, never read
// companyInfo/businessConfig directly for anything that varies by tenant.
const TTL_MS = 10_000

export type TenantBranding = {
  companyName: string
  companyShortName: string
  country: string
  currency: string
  companyAddress: string
  companyPhone: string
  companyEmail: string
  logoPath: string
  logoVersion: string
}

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

const DEFAULT_BRANDING: TenantBranding = {
  companyName: companyInfo.displayName,
  companyShortName: companyInfo.shortName,
  country: companyInfo.country,
  currency: businessConfig.currency,
  companyAddress: companyInfo.address,
  companyPhone: companyInfo.phone,
  companyEmail: companyInfo.email,
  logoPath: companyInfo.logoPath,
  logoVersion: hashLogo(companyInfo.logoPath),
}

function resolve(settings: LoadedSettings): TenantBranding {
  const logoPath = settings.logoDataUrl || DEFAULT_BRANDING.logoPath
  return {
    companyName: settings.companyName,
    companyShortName: settings.companyShortName,
    country: settings.country,
    currency: settings.currency,
    companyAddress: settings.companyAddress || DEFAULT_BRANDING.companyAddress,
    companyPhone: settings.companyPhone || DEFAULT_BRANDING.companyPhone,
    companyEmail: settings.companyEmail || DEFAULT_BRANDING.companyEmail,
    logoPath,
    logoVersion: hashLogo(logoPath),
  }
}

const cache = new Map<number, { data: TenantBranding; expiresAt: number }>()

/** The branding to show when there's no tenant yet (e.g. the login page, before auth). */
export function getDefaultBranding(): TenantBranding {
  return DEFAULT_BRANDING
}

/** Resolves + caches (briefly) the branding for one tenant. Never mutates shared state. */
export async function getTenantBranding(tenantId: number): Promise<TenantBranding> {
  const hit = cache.get(tenantId)
  if (hit && hit.expiresAt > Date.now()) return hit.data
  const settings = await getAppSettings(tenantId)
  const data = settings ? resolve(settings) : DEFAULT_BRANDING
  cache.set(tenantId, { data, expiresAt: Date.now() + TTL_MS })
  return data
}

/** Called right after a successful save so the change is visible immediately, not after the TTL. */
export function primeTenantBranding(tenantId: number, settings: LoadedSettings) {
  cache.set(tenantId, { data: resolve(settings), expiresAt: Date.now() + TTL_MS })
}

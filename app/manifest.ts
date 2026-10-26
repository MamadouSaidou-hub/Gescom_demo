import type { MetadataRoute } from 'next'
import { getDefaultBranding, getTenantBranding } from '@/lib/settings-cache'
import { getSessionContext } from '@/lib/session'

// This route lives outside the app/layout.tsx tree, so it needs its own opt-out of static caching
// — see the comment on `dynamic` in app/layout.tsx for why.
export const dynamic = 'force-dynamic'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const ctx = await getSessionContext()
  const branding = ctx ? await getTenantBranding(ctx.tenantId) : getDefaultBranding()
  return {
    name: `${branding.companyName} — Gestion`,
    short_name: branding.companyShortName,
    description: 'Pilotez vos magasins, vos ventes et votre trésorerie depuis un seul espace.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f9fc',
    theme_color: '#f7f9fc',
    orientation: 'portrait',
    icons: [
      { src: branding.logoPath, sizes: '192x192', type: 'image/jpeg' },
      { src: branding.logoPath, sizes: '512x512', type: 'image/jpeg' },
      { src: branding.logoPath, sizes: '512x512', type: 'image/jpeg', purpose: 'maskable' },
    ],
  }
}

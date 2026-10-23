import type { MetadataRoute } from 'next'
import { companyInfo } from '@/lib/company-info'
import { ensureSettingsLoaded } from '@/lib/settings-cache'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  await ensureSettingsLoaded()
  return {
    name: `${companyInfo.displayName} — Gestion`,
    short_name: companyInfo.shortName,
    description: 'Pilotez vos magasins, vos ventes et votre trésorerie depuis un seul espace.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f9fc',
    theme_color: '#f7f9fc',
    orientation: 'portrait',
    icons: [
      { src: companyInfo.logoPath, sizes: '192x192', type: 'image/jpeg' },
      { src: companyInfo.logoPath, sizes: '512x512', type: 'image/jpeg' },
      { src: companyInfo.logoPath, sizes: '512x512', type: 'image/jpeg', purpose: 'maskable' },
    ],
  }
}

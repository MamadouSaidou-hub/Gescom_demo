import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { companyInfo } from '@/lib/company-info'
import { businessConfig } from '@/lib/business-config'
import { ensureSettingsLoaded } from '@/lib/settings-cache'
import { SettingsProvider } from '@/components/settings-provider'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export async function generateMetadata(): Promise<Metadata> {
  await ensureSettingsLoaded()
  return {
    title: `${companyInfo.shortName} · Tableau de bord`,
    description: 'Pilotez vos magasins, vos ventes et votre trésorerie depuis un seul espace.',
    generator: `${companyInfo.shortName} ${companyInfo.displayName}`,
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: companyInfo.shortName,
    },
    formatDetection: { telephone: false },
  }
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: '#f7f9fc',
  userScalable: true,
  viewportFit: 'cover',
}

// Runs before paint to avoid a flash of the wrong theme/accent color.
const themeScript = `
try {
  var theme = localStorage.getItem('bgm-theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  } else {
    document.documentElement.style.colorScheme = 'light dark';
  }
  var accent = localStorage.getItem('bgm-accent-color');
  if (accent) document.documentElement.style.setProperty('--primary', accent);
} catch (e) {}
`

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await ensureSettingsLoaded()
  const settings = {
    companyName: companyInfo.displayName,
    companyShortName: companyInfo.shortName,
    country: companyInfo.country,
    currency: businessConfig.currency,
    address: companyInfo.address,
    phone: companyInfo.phone,
    email: companyInfo.email,
  }

  return (
    <html lang="fr" className={`bg-background ${inter.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        <SettingsProvider value={settings}>{children}</SettingsProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}

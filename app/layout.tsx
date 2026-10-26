import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import './globals.css'
import { getDefaultBranding, getTenantBranding } from '@/lib/settings-cache'
import { getSessionState } from '@/lib/session'
import { SettingsProvider } from '@/components/settings-provider'

// Resolves branding fresh for *this* request — never a shared mutable global — so concurrent
// requests from different tenants on the same server instance can never see each other's
// company name/logo/currency. Falls back to the static demo defaults when there's no session
// yet (e.g. the login page).
async function resolveRequestBranding() {
  const state = await getSessionState()
  return state.kind === 'active' ? getTenantBranding(state.ctx.tenantId) : getDefaultBranding()
}

// A suspended workspace still has a valid session cookie, so without this the client lands on the
// normal shell where every request fails — an explanation beats a wall of errors. The API routes
// enforce the suspension independently (getSessionContext returns null), so this is purely UX.
async function redirectIfSuspended() {
  const state = await getSessionState()
  if (state.kind !== 'suspended') return
  const pathname = (await headers()).get('x-pathname') ?? ''
  if (pathname.startsWith('/suspendu')) return
  redirect('/suspendu')
}

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

// Without this, Next.js prerenders every page that doesn't itself call a Dynamic API (headers(),
// cookies()...) as static HTML at build time — which is most pages here, since their data loads
// client-side via fetch(). That froze the branding (logo, company name, currency) read in this
// layout to whatever was in the database at the last deploy: saving Paramètres updated the
// database correctly, but the static shell never re-rendered to pick it up. Forcing the whole tree
// dynamic makes every request re-read the current settings.
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const branding = await resolveRequestBranding()
  return {
    title: `${branding.companyShortName} · Tableau de bord`,
    description: 'Pilotez vos magasins, vos ventes et votre trésorerie depuis un seul espace.',
    generator: `${branding.companyShortName} ${branding.companyName}`,
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: branding.companyShortName,
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
  await redirectIfSuspended()
  const branding = await resolveRequestBranding()
  const settings = {
    companyName: branding.companyName,
    companyShortName: branding.companyShortName,
    country: branding.country,
    currency: branding.currency,
    address: branding.companyAddress,
    phone: branding.companyPhone,
    email: branding.companyEmail,
  }

  return (
    // suppressHydrationWarning: themeScript below runs before React and sets `data-theme` and
    // `color-scheme` on this element from localStorage, which the server cannot know — so the
    // markup legitimately differs on arrival. Scoped to this element's own attributes only, one
    // level deep: a real mismatch anywhere else in the tree is still reported.
    <html lang="fr" className={`bg-background ${inter.variable}`} suppressHydrationWarning>
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

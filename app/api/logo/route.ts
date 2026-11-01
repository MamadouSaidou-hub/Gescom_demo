import { NextRequest, NextResponse } from 'next/server'
import { getDefaultBranding, getTenantBranding } from '@/lib/settings-cache'
import { getSessionContext } from '@/lib/session'

// A stable URL for the current logo — static file by default, or the uploaded data: URL once a
// client sets one from Paramètres. Keeping this as a dedicated endpoint (rather than threading a
// ~1MB base64 string through the React settings context) avoids bloating every single page's payload
// with logo bytes it may not even render.
export async function GET(request: NextRequest) {
  const ctx = await getSessionContext()
  const branding = ctx ? await getTenantBranding(ctx.tenantId) : getDefaultBranding()
  const logo = branding.logoPath

  // Every consumer of this route appends `?v=<logoVersion>` (a hash of the logo itself — see
  // settings-cache.ts), so the URL only ever changes when the logo's bytes do. That means we can
  // cache this response essentially forever: there is no "stale" version of a given URL to worry
  // about, so there's no need for a short max-age/cache-clearing dance on every logo change.
  // Requests missing `?v=` (an old cached page shell, a direct hit) fall back to a short TTL.
  const hasVersion = request.nextUrl.searchParams.has('v')
  const cacheControl = hasVersion ? 'public, max-age=31536000, immutable' : 'private, max-age=60'

  if (!logo.startsWith('data:')) {
    return NextResponse.redirect(new URL(logo, request.url), 307)
  }

  const match = logo.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return NextResponse.json({ error: 'Logo invalide.' }, { status: 500 })
  const [, mimeType, base64] = match
  const bytes = Buffer.from(base64, 'base64')

  return new NextResponse(bytes, {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': cacheControl,
    },
  })
}

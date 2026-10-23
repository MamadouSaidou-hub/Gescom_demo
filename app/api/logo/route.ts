import { NextRequest, NextResponse } from 'next/server'
import { companyInfo } from '@/lib/company-info'
import { ensureSettingsLoaded } from '@/lib/settings-cache'

// A stable URL for the current logo — static file by default, or the uploaded data: URL once a
// client sets one from Paramètres. Keeping this as a dedicated endpoint (rather than threading a
// ~1MB base64 string through the React settings context) avoids bloating every single page's payload
// with logo bytes it may not even render.
export async function GET(request: NextRequest) {
  await ensureSettingsLoaded()
  const logo = companyInfo.logoPath

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
      'Cache-Control': 'private, max-age=60',
    },
  })
}

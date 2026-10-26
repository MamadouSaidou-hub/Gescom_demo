import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request)

  if (!sessionCookie) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  // Server components can't read the current path, and the suspended-workspace redirect in
  // app/layout.tsx needs it to avoid redirecting the suspended page onto itself. This runs on the
  // edge runtime, so it can't check the tenant's status here — only pass the path along.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', request.nextUrl.pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/((?!login|api/auth|api/logo|_next/static|_next/image|favicon\\.ico|icon\\.jpeg|apple-icon\\.jpeg|logo-bgm\\.jpeg|manifest\\.webmanifest).*)'],
}

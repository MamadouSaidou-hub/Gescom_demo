import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { admin } from 'better-auth/plugins'
import { db } from './db/client'
import { account, rateLimit, session, user, verification } from './db/auth-schema'

// Vercel serves every deployment from several hostnames at once — the production domain, a
// stable per-branch alias (…-git-main-<team>.vercel.app), and a unique per-deployment URL — but
// better-auth only trusts BETTER_AUTH_URL's own origin by default and rejects sign-in requests
// from any other ("Invalid origin"), even though they're all the same app. Vercel sets these
// three env vars itself at runtime, so this adapts automatically without hand-maintaining a list
// of URLs on every deploy.
const trustedOrigins = [
  'http://localhost:3000',
  process.env.BETTER_AUTH_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  process.env.VERCEL_BRANCH_URL && `https://${process.env.VERCEL_BRANCH_URL}`,
  process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
].filter((value): value is string => Boolean(value))

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification, rateLimit },
  }),
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
  },
  // Default storage is an in-memory Map, which resets on every cold start and isn't shared across
  // serverless instances — on a multi-instance prod deploy that makes the brute-force protection on
  // /sign-in (3 attempts/10s by default) effectively a no-op. Database storage makes it real.
  rateLimit: {
    storage: 'database',
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'gestionnaire',
        input: false,
      },
      storeId: {
        type: 'number',
        required: false,
        input: false,
      },
      tenantId: {
        type: 'number',
        required: false,
        input: false,
      },
      platformAdmin: {
        type: 'boolean',
        defaultValue: false,
        input: false,
      },
      permissions: {
        type: 'string',
        defaultValue: '',
        input: false,
      },
    },
  },
  plugins: [
    admin({
      defaultRole: 'gestionnaire',
      adminRoles: ['admin'],
    }),
    // nextCookies() must be the last plugin — it auto-attaches Set-Cookie headers to the current
    // Next.js response for whichever better-auth endpoint just ran in this request.
    nextCookies(),
  ],
})

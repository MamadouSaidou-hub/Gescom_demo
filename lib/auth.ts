import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { admin } from 'better-auth/plugins'
import { db } from './db/client'
import { account, rateLimit, session, user, verification } from './db/auth-schema'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification, rateLimit },
  }),
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

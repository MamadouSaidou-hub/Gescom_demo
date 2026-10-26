// Superseded by scripts/create-tenant.ts now that every user needs a tenantId (NOT NULL, no
// default) — this script has no tenant to assign and will fail the DB constraint if run.
// Kept only as a reference for the pre-multi-tenant seeding pattern.
import { eq } from 'drizzle-orm'
import { auth } from '../auth'
import { db } from './client'
import { user } from './auth-schema'

const ADMIN_EMAIL = 'admin@bgm.local'
const ADMIN_PASSWORD = 'ChangeMoi123!'
const ADMIN_NAME = 'Administrateur BGM'

async function seedAdmin() {
  const [existing] = await db.select().from(user).where(eq(user.email, ADMIN_EMAIL))
  if (existing) {
    console.log(`Un compte admin existe déjà (${ADMIN_EMAIL}).`)
    return
  }

  await auth.api.signUpEmail({
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME },
  })

  await db.update(user).set({ role: 'admin' }).where(eq(user.email, ADMIN_EMAIL))

  console.log('Compte administrateur créé :')
  console.log(`  E-mail : ${ADMIN_EMAIL}`)
  console.log(`  Mot de passe : ${ADMIN_PASSWORD}`)
  console.log('Pensez à changer ce mot de passe après la première connexion.')
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

// CLI provisioning script for a new SaaS tenant — run manually, not from the app. Thin wrapper
// around lib/db/mutations/tenants.ts's createTenant(), the same function the platform-admin UI
// uses (app/api/platform/tenants/route.ts).
// Usage:
//   npm run create-tenant -- --name "Client X" --slug client-x --country "Sénégal" \
//     --currency XOF --admin-email admin@clientx.com --admin-password "Secret123!" \
//     --admin-name "Admin Client X" --store-name "Magasin principal" --store-city "Dakar"
import { createTenant } from '../lib/db/mutations/tenants'

function requireArg(args: Record<string, string>, key: string): string {
  const value = args[key]
  if (!value) throw new Error(`Argument manquant : --${key}`)
  return value
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const value = argv[i + 1]
    out[key] = value
    i++
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { tenant, storeId } = await createTenant({
    name: requireArg(args, 'name'),
    slug: requireArg(args, 'slug'),
    country: requireArg(args, 'country'),
    currency: requireArg(args, 'currency').toUpperCase(),
    adminEmail: requireArg(args, 'admin-email'),
    adminPassword: requireArg(args, 'admin-password'),
    adminName: requireArg(args, 'admin-name'),
    storeName: requireArg(args, 'store-name'),
    storeCity: requireArg(args, 'store-city'),
  })
  console.log(`Tenant créé : ${tenant.name} (id=${tenant.id}, slug=${tenant.slug})`)
  console.log(`Magasin par défaut créé : id=${storeId}`)
  console.log(`Compte administrateur créé : ${args['admin-email']}`)
  console.log('\nTerminé. Communiquez les identifiants au client par un canal sûr.')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

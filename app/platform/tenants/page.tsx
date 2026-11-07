import { notFound } from 'next/navigation'
import { getSessionContext, isPlatformAdmin } from '@/lib/session'
import { PlatformTenantsView } from '@/components/platform-tenants-view'

export default async function Page() {
  const ctx = await getSessionContext()
  if (!ctx || !isPlatformAdmin(ctx)) notFound()
  return <PlatformTenantsView />
}

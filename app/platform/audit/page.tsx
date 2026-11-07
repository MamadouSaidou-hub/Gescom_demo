import { notFound } from 'next/navigation'
import { getSessionContext, isPlatformAdmin } from '@/lib/session'
import { PlatformAuditView } from '@/components/platform-audit-view'

export default async function Page() {
  const ctx = await getSessionContext()
  if (!ctx || !isPlatformAdmin(ctx)) notFound()
  return <PlatformAuditView />
}

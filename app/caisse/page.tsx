import { notFound } from 'next/navigation'
import { getSessionContext, hasPermission } from '@/lib/session'
import { CaisseView } from '@/components/caisse-view'

export default async function Page() {
  const ctx = await getSessionContext()
  if (!ctx || !hasPermission(ctx, 'treasury')) notFound()
  return <CaisseView />
}

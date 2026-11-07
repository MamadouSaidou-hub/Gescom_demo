import { notFound } from 'next/navigation'
import { getSessionContext, hasPermission } from '@/lib/session'
import { TreasuryView } from '@/components/treasury-view'

export default async function Page() {
  const ctx = await getSessionContext()
  if (!ctx || !hasPermission(ctx, 'treasury')) notFound()
  return <TreasuryView />
}

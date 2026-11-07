import { notFound } from 'next/navigation'
import { getSessionContext, hasPermission } from '@/lib/session'
import { TransfertsView } from '@/components/transferts-view'

export default async function Page() {
  const ctx = await getSessionContext()
  if (!ctx || !hasPermission(ctx, 'transfers')) notFound()
  return <TransfertsView />
}

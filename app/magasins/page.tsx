import { notFound } from 'next/navigation'
import { getSessionContext, hasPermission } from '@/lib/session'
import { StoresView } from '@/components/stores-view'

export default async function Page() {
  const ctx = await getSessionContext()
  if (!ctx || !hasPermission(ctx, 'stores')) notFound()
  return <StoresView />
}

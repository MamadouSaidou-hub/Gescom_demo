import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { getSessionContext, hasPermission } from '@/lib/session'
import { FournisseursView } from '@/components/fournisseurs-view'

export default async function Page() {
  const ctx = await getSessionContext()
  if (!ctx || !hasPermission(ctx, 'suppliers')) notFound()

  return (
    <Suspense>
      <FournisseursView />
    </Suspense>
  )
}

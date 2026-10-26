'use client'

import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export function SuspendedActions() {
  const router = useRouter()

  async function handleLogout() {
    await authClient.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button type="button" className="btn-secondary" onClick={handleLogout}>
      Se déconnecter
    </button>
  )
}

import { PauseCircle } from 'lucide-react'
import { SuspendedActions } from './suspended-actions'

export default function Page() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 440, textAlign: 'center' }}>
        <PauseCircle size={44} style={{ color: '#c17800', marginBottom: 16 }} aria-hidden="true" />
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 10px' }}>Accès temporairement suspendu</h1>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65, margin: '0 0 22px' }}>
          L’accès à votre espace de gestion est actuellement suspendu. Vos données sont conservées et seront
          intégralement disponibles dès la réactivation. Contactez votre prestataire pour rétablir l’accès.
        </p>
        <SuspendedActions />
      </div>
    </div>
  )
}

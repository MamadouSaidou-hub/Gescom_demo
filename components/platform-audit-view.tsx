'use client'

import { useEffect, useState } from 'react'
import { FileClock, ShieldAlert, ShieldCheck } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { LoadError } from '@/components/load-error'
import { fetchJson } from '@/lib/fetch-json'
import { auditActionLabel, type AuditAction } from '@/lib/audit-labels'

type AuditEvent = {
  id: number
  actorEmail: string
  tenantId: number | null
  action: string
  targetType: string
  targetId: string
  payload: Record<string, unknown>
  entryHash: string
  createdAt: string
}

type Verification = {
  ok: boolean
  entriesChecked: number
  brokenAtId: number | null
  reason: string | null
}

const actionTone: Record<string, string> = {
  'user.created': 'badge-green',
  'user.role_changed': 'badge-blue',
  'user.deleted': 'badge-red',
  'tenant.created': 'badge-green',
  'tenant.suspended': 'badge-red',
  'tenant.reactivated': 'badge-green',
}

/** Renders the stored payload as compact, readable key/value pairs rather than raw JSON. */
function PayloadSummary({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (entries.length === 0) return <span style={{ color: 'var(--faint)' }}>—</span>
  return (
    <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
      {entries.map(([key, value], index) => (
        <span key={key}>
          {index > 0 && ' · '}
          <span style={{ color: 'var(--faint)' }}>{key}</span> {String(value)}
        </span>
      ))}
    </span>
  )
}

export function PlatformAuditView() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [verification, setVerification] = useState<Verification | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetchJson<{ events: AuditEvent[]; total: number; verification: Verification }>('/api/platform/audit')
      .then((json) => {
        if (cancelled) return
        setEvents(json.events ?? [])
        setTotal(json.total ?? 0)
        setVerification(json.verification ?? null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erreur inconnue.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return (
    <AppShell breadcrumb="Plateforme" section="Journal d’audit">
      <section className="page-heading">
        <div>
          <p className="eyebrow">TRAÇABILITÉ</p>
          <h1>Journal <span>d’audit</span></h1>
          <p className="heading-subtitle">
            Trace infalsifiable des actions sensibles : création et suppression de comptes, changements de rôle,
            provisionnement et suspension de clients.
          </p>
        </div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      {verification && (
        <div
          className="toolbar-panel"
          style={{
            gap: 10,
            alignItems: 'center',
            borderLeft: `3px solid ${verification.ok ? '#2e9e3f' : '#c0392b'}`,
          }}
        >
          {verification.ok ? <ShieldCheck size={16} style={{ color: '#2e9e3f' }} /> : <ShieldAlert size={16} style={{ color: '#c0392b' }} />}
          <div style={{ fontSize: 12.5 }}>
            <strong>{verification.ok ? 'Chaîne intègre' : 'Chaîne corrompue'}</strong>{' '}
            <span style={{ color: 'var(--muted)' }}>
              {verification.ok
                ? `${verification.entriesChecked} entrée(s) vérifiée(s) — aucune modification ni suppression détectée.`
                : verification.reason}
            </span>
          </div>
          <div className="toolbar-spacer" />
          <button className="btn-secondary" onClick={() => setRefreshKey((key) => key + 1)}>Revérifier</button>
        </div>
      )}

      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Action</th>
                <th>Auteur</th>
                <th>Cible</th>
                <th>Détails</th>
                <th>Empreinte</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td data-label="Date" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(event.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td data-label="Action">
                    <span className={`badge ${actionTone[event.action] ?? 'badge-muted'}`}>
                      {auditActionLabel[event.action as AuditAction] ?? event.action}
                    </span>
                  </td>
                  <td data-label="Auteur">{event.actorEmail}</td>
                  <td data-label="Cible">
                    {event.targetType === 'tenant' ? 'Client' : 'Utilisateur'} <span style={{ color: 'var(--faint)' }}>#{event.targetId}</span>
                  </td>
                  <td data-label="Détails"><PayloadSummary payload={event.payload} /></td>
                  <td data-label="Empreinte" style={{ fontFamily: 'monospace', fontSize: 10.5, color: 'var(--faint)' }}>
                    {event.entryHash.slice(0, 10)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && events.length === 0 && <p className="table-empty">Aucune action enregistrée pour l’instant.</p>}
        </div>
      </div>

      {total > events.length && (
        <p className="heading-subtitle" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileClock size={13} /> {events.length} dernières entrées affichées sur {total} au total.
        </p>
      )}
    </AppShell>
  )
}

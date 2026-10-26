'use client'

import { useEffect, useState } from 'react'
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, Users } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Modal } from '@/components/modal'
import { LoadError } from '@/components/load-error'
import { authClient } from '@/lib/auth-client'
import { fetchJson } from '@/lib/fetch-json'
import { PERMISSIONS, permissionLabel, permissionHelp, type Permission } from '@/lib/permissions'

type UserRow = { id: string; name: string; email: string; role: string; storeId: number | null; store: string; permissions: Permission[] }
type StoreOption = { id: number; name: string }

const roleLabel: Record<string, string> = { admin: 'Administrateur', gestionnaire: 'Gestionnaire' }
const roleBadge: Record<string, string> = { admin: 'badge-blue', gestionnaire: 'badge-green' }

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Users; tone: 'navy' | 'green' | 'orange' | 'blue' }) {
  return (
    <article className="metric-card">
      <div className="metric-topline"><span className={`metric-icon metric-icon-${tone}`}><Icon aria-hidden="true" /></span></div>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </article>
  )
}

/** The checkbox grid shared by create/edit — a gestionnaire's access is whatever is checked here, nothing more. */
function PermissionCheckboxes({ permissions, onChange }: { permissions: Permission[]; onChange: (next: Permission[]) => void }) {
  function toggle(permission: Permission) {
    onChange(permissions.includes(permission) ? permissions.filter((p) => p !== permission) : [...permissions, permission])
  }

  return (
    <div className="form-field">
      <label>Permissions</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px 16px', marginTop: 4 }}>
        {PERMISSIONS.map((permission) => (
          <label
            key={permission}
            title={permissionHelp[permission]}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, fontWeight: 400, color: 'var(--ink)', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={permissions.includes(permission)}
              onChange={() => toggle(permission)}
              style={{ width: 14, height: 14, marginTop: 1, flexShrink: 0 }}
            />
            {permissionLabel[permission]}
          </label>
        ))}
      </div>
    </div>
  )
}

function NewUserForm({ storeOptions, onCreated }: { storeOptions: StoreOption[]; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'gestionnaire'>('gestionnaire')
  const [storeId, setStoreId] = useState('')
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!storeId && storeOptions.length > 0) setStoreId(String(storeOptions[0].id))
  }, [storeOptions, storeId])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/utilisateurs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role, storeId: role === 'gestionnaire' ? storeId : null, permissions }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      onCreated()
    } catch {
      setError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}
      <div className="form-field"><label>Nom complet</label><input required value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div className="form-field"><label>Adresse e-mail</label><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      <div className="form-field"><label>Mot de passe</label><input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></div>
      <div className="form-row">
        <div className="form-field">
          <label>Rôle</label>
          <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            <option value="gestionnaire">Gestionnaire</option>
            <option value="admin">Administrateur</option>
          </select>
        </div>
        {role === 'gestionnaire' && (
          <div className="form-field">
            <label>Magasin</label>
            <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
              {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </div>
        )}
      </div>
      {role === 'gestionnaire' && <PermissionCheckboxes permissions={permissions} onChange={setPermissions} />}
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Création...' : 'Créer le compte'}</button></div>
    </form>
  )
}

function EditUserForm({
  targetUser,
  storeOptions,
  onSaved,
}: {
  targetUser: UserRow
  storeOptions: StoreOption[]
  onSaved: () => void
}) {
  const [role, setRole] = useState<'admin' | 'gestionnaire'>(targetUser.role === 'admin' ? 'admin' : 'gestionnaire')
  const [storeId, setStoreId] = useState(targetUser.storeId ? String(targetUser.storeId) : '')
  const [permissions, setPermissions] = useState<Permission[]>(targetUser.permissions)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (role === 'gestionnaire' && !storeId && storeOptions.length > 0) setStoreId(String(storeOptions[0].id))
  }, [role, storeId, storeOptions])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/utilisateurs/${targetUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, storeId: role === 'gestionnaire' ? storeId : null, permissions }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      onSaved()
    } catch {
      setError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}
      <div className="form-field"><label>Nom</label><input disabled value={targetUser.name} /></div>
      <div className="form-field"><label>E-mail</label><input disabled value={targetUser.email} /></div>
      <div className="form-row">
        <div className="form-field">
          <label>Rôle</label>
          <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            <option value="gestionnaire">Gestionnaire</option>
            <option value="admin">Administrateur</option>
          </select>
        </div>
        {role === 'gestionnaire' && (
          <div className="form-field">
            <label>Magasin</label>
            <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
              {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </div>
        )}
      </div>
      {role === 'gestionnaire' && <PermissionCheckboxes permissions={permissions} onChange={setPermissions} />}
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer'}</button></div>
    </form>
  )
}

function ResetPasswordForm({ targetUser, onDone }: { targetUser: UserRow; onDone: () => void }) {
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/utilisateurs/${targetUser.id}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      setDone(true)
    } catch {
      setError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div>
        <p style={{ fontSize: 12.5, color: 'var(--ink)', marginBottom: 16 }}>
          Mot de passe mis à jour pour <strong>{targetUser.email}</strong>. Communiquez-le à la personne par un canal sûr — il ne sera plus affiché après fermeture.
        </p>
        <div className="form-actions"><button type="button" className="btn-primary" onClick={onDone}>Fermer</button></div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}
      <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 14 }}>
        Définissez un nouveau mot de passe pour <strong>{targetUser.email}</strong>. Pas d’e-mail envoyé — communiquez-le vous-même à la personne.
      </p>
      <div className="form-field"><label>Nouveau mot de passe</label><input required type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Réinitialiser'}</button></div>
    </form>
  )
}

export function UtilisateursView() {
  const { data: session } = authClient.useSession()
  const [users, setUsers] = useState<UserRow[]>([])
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserRow | null>(null)
  const [resettingUser, setResettingUser] = useState<UserRow | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetchJson<{ users: UserRow[] }>('/api/utilisateurs')
      .then((json) => {
        if (!cancelled) setUsers(json.users ?? [])
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

  useEffect(() => {
    fetchJson<{ stores: StoreOption[] }>('/api/magasins').then((json) => setStoreOptions(json.stores)).catch(() => {})
  }, [refreshKey])

  const adminCount = users.filter((u) => u.role === 'admin').length
  const currentUserId = session?.user?.id

  async function handleDelete(id: string) {
    setDeleteError('')
    setDeletingId(id)
    try {
      const res = await fetch(`/api/utilisateurs/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) {
        setDeleteError(json.error ?? 'Une erreur est survenue.')
        return
      }
      setRefreshKey((key) => key + 1)
    } catch {
      setDeleteError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <AppShell breadcrumb="Administration" section="Utilisateurs">
      <section className="page-heading">
        <div><p className="eyebrow">ACCÈS</p><h1>Utilisateurs <span>et permissions</span></h1><p className="heading-subtitle">Gérez les comptes administrateurs et gestionnaires de magasin.</p></div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      <section className="metrics-grid" aria-label="Indicateurs utilisateurs">
        <MetricCard label="Total comptes" value={`${users.length}`} icon={Users} tone="navy" />
        <MetricCard label="Administrateurs" value={`${adminCount}`} icon={ShieldCheck} tone="blue" />
      </section>

      <div className="toolbar-panel">
        <div className="toolbar-spacer" />
        <button className="btn-primary" onClick={() => setModalOpen(true)}><Plus size={14} /> Nouvel utilisateur</button>
      </div>

      {deleteError && <p className="form-error">{deleteError}</p>}

      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>E-mail</th>
                <th>Rôle</th>
                <th>Magasin</th>
                <th>Permissions</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => {
                const isSelf = row.id === currentUserId
                return (
                  <tr key={row.id}>
                    <td data-label="Nom">{row.name}</td>
                    <td data-label="E-mail">{row.email}</td>
                    <td data-label="Rôle"><span className={`badge ${roleBadge[row.role] ?? 'badge-muted'}`}>{roleLabel[row.role] ?? row.role}</span></td>
                    <td data-label="Magasin">{row.role === 'admin' ? 'Tous les magasins' : row.store}</td>
                    <td data-label="Permissions" style={{ fontSize: 10.5, color: 'var(--muted)', maxWidth: 220 }}>
                      {row.role === 'admin' ? 'Toutes' : row.permissions.length > 0 ? row.permissions.map((p) => permissionLabel[p]).join(', ') : '—'}
                    </td>
                    <td data-label="" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="icon-button"
                        title="Réinitialiser le mot de passe"
                        aria-label={`Réinitialiser le mot de passe de ${row.name}`}
                        onClick={() => setResettingUser(row)}
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        title="Modifier"
                        aria-label={`Modifier ${row.name}`}
                        onClick={() => setEditingUser(row)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        title={isSelf ? 'Vous ne pouvez pas supprimer votre propre compte' : 'Supprimer'}
                        aria-label={`Supprimer ${row.name}`}
                        disabled={isSelf || deletingId === row.id}
                        onClick={() => {
                          if (window.confirm(`Supprimer le compte de ${row.name} ? Cette action est irréversible.`)) {
                            handleDelete(row.id)
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!loading && users.length === 0 && <p className="table-empty">Aucun utilisateur.</p>}
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvel utilisateur" subtitle="Créez un accès administrateur ou gestionnaire de magasin.">
        <NewUserForm
          storeOptions={storeOptions}
          onCreated={() => {
            setModalOpen(false)
            setRefreshKey((key) => key + 1)
          }}
        />
      </Modal>

      <Modal open={editingUser !== null} onClose={() => setEditingUser(null)} title="Modifier l’utilisateur" subtitle="Changez le rôle, le magasin ou les permissions.">
        {editingUser && (
          <EditUserForm
            targetUser={editingUser}
            storeOptions={storeOptions}
            onSaved={() => {
              setEditingUser(null)
              setRefreshKey((key) => key + 1)
            }}
          />
        )}
      </Modal>

      <Modal open={resettingUser !== null} onClose={() => setResettingUser(null)} title="Réinitialiser le mot de passe" subtitle="Pour un compte qui a oublié son mot de passe.">
        {resettingUser && (
          <ResetPasswordForm
            targetUser={resettingUser}
            onDone={() => {
              setResettingUser(null)
              setRefreshKey((key) => key + 1)
            }}
          />
        )}
      </Modal>
    </AppShell>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { Building2, Pause, Play, Plus, ShieldCheck, Users } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { AppShell } from '@/components/app-shell'
import { Modal } from '@/components/modal'
import { LoadError } from '@/components/load-error'
import { fetchJson } from '@/lib/fetch-json'
import { COUNTRY_OPTIONS, OTHER_COUNTRY, currencyForCountry } from '@/lib/countries'

type TenantRow = {
  id: number
  name: string
  slug: string
  country: string
  currency: string
  status: string
  createdAt: string
  userCount: number
  adminEmail: string | null
}

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Users; tone: 'navy' | 'green' | 'orange' | 'blue' }) {
  return (
    <article className="metric-card">
      <div className="metric-topline"><span className={`metric-icon metric-icon-${tone}`}><Icon aria-hidden="true" /></span></div>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </article>
  )
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function NewTenantForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [country, setCountry] = useState<string>(COUNTRY_OPTIONS[0].name)
  const [currency, setCurrency] = useState<string>(COUNTRY_OPTIONS[0].currency)
  const [customCountry, setCustomCountry] = useState(false)
  const [storeName, setStoreName] = useState('Magasin principal')
  const [storeCity, setStoreCity] = useState('')
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function handleNameChange(value: string) {
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  // Picking a country fills in the currency normally used there; "Autre" switches both to free
  // text so a market outside the list is still possible without a code change.
  function handleCountryChange(value: string) {
    if (value === OTHER_COUNTRY) {
      setCustomCountry(true)
      setCountry('')
      setCurrency('')
      return
    }
    setCustomCountry(false)
    setCountry(value)
    setCurrency(currencyForCountry(value) ?? currency)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/platform/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, country, currency, storeName, storeCity, adminName, adminEmail, adminPassword }),
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
      <div className="form-row">
        <div className="form-field"><label>Nom du client</label><input required value={name} onChange={(event) => handleNameChange(event.target.value)} placeholder="Ex : Boutique Faso" /></div>
        <div className="form-field">
          <label>Slug</label>
          <input required value={slug} onChange={(event) => { setSlug(slugify(event.target.value)); setSlugTouched(true) }} placeholder="boutique-faso" />
        </div>
      </div>
      <div className="form-row">
        <div className="form-field">
          <label>Pays</label>
          <select required value={customCountry ? OTHER_COUNTRY : country} onChange={(event) => handleCountryChange(event.target.value)}>
            {COUNTRY_OPTIONS.map((option) => (
              <option key={option.name} value={option.name}>{option.name}</option>
            ))}
            <option value={OTHER_COUNTRY}>{OTHER_COUNTRY}…</option>
          </select>
        </div>
        <div className="form-field">
          <label>Devise</label>
          <input
            required
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            placeholder="Ex : GNF, FCFA, DJF"
            maxLength={6}
            readOnly={!customCountry}
            disabled={!customCountry}
          />
        </div>
      </div>
      {customCountry && (
        <div className="form-field">
          <label>Nom du pays</label>
          <input required value={country} onChange={(event) => setCountry(event.target.value)} placeholder="Ex : Maroc" />
        </div>
      )}
      <div className="form-row">
        <div className="form-field"><label>Magasin par défaut</label><input required value={storeName} onChange={(event) => setStoreName(event.target.value)} /></div>
        <div className="form-field"><label>Ville</label><input required value={storeCity} onChange={(event) => setStoreCity(event.target.value)} /></div>
      </div>
      <p className="heading-subtitle" style={{ margin: '14px 0 6px' }}>Premier compte administrateur</p>
      <div className="form-row">
        <div className="form-field"><label>Nom</label><input required value={adminName} onChange={(event) => setAdminName(event.target.value)} /></div>
        <div className="form-field"><label>E-mail</label><input required type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} /></div>
      </div>
      <div className="form-field"><label>Mot de passe initial</label><input required type="password" minLength={8} value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Création...' : 'Créer le tenant'}</button></div>
    </form>
  )
}

export function PlatformTenantsView() {
  const { data: session } = authClient.useSession()
  const ownTenantId = (session?.user as { tenantId?: number } | undefined)?.tenantId
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  async function toggleStatus(row: TenantRow) {
    const next = row.status === 'active' ? 'suspended' : 'active'
    const confirmMessage =
      next === 'suspended'
        ? `Suspendre « ${row.name} » ? Ses utilisateurs perdront l’accès à l’application sous quelques secondes.`
        : `Réactiver « ${row.name} » ? Ses utilisateurs retrouveront l’accès.`
    if (!window.confirm(confirmMessage)) return

    setActionError('')
    setPendingId(row.id)
    try {
      const res = await fetch(`/api/platform/tenants/${row.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const json = await res.json()
      if (!res.ok) {
        setActionError(json.error ?? 'Une erreur est survenue.')
        return
      }
      setRefreshKey((key) => key + 1)
    } catch {
      setActionError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setPendingId(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetchJson<{ tenants: TenantRow[] }>('/api/platform/tenants')
      .then((json) => {
        if (!cancelled) setTenants(json.tenants ?? [])
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

  const activeCount = tenants.filter((t) => t.status === 'active').length
  const totalUsers = tenants.reduce((sum, t) => sum + t.userCount, 0)

  return (
    <AppShell breadcrumb="Plateforme" section="Tenants">
      <section className="page-heading">
        <div><p className="eyebrow">SAAS</p><h1>Clients <span>de la plateforme</span></h1><p className="heading-subtitle">Créez et consultez les espaces clients (tenants) isolés de ce SaaS.</p></div>
        <div className="filter-row">
          <button className="btn-primary" onClick={() => setModalOpen(true)}><Plus size={14} /> Nouveau tenant</button>
        </div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}
      {actionError && <p className="form-error">{actionError}</p>}

      <section className="metrics-grid" aria-label="Indicateurs plateforme">
        <MetricCard label="Tenants" value={`${tenants.length}`} icon={Building2} tone="navy" />
        <MetricCard label="Actifs" value={`${activeCount}`} icon={ShieldCheck} tone="green" />
        <MetricCard label="Comptes au total" value={`${totalUsers}`} icon={Users} tone="blue" />
      </section>

      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Slug</th>
                <th>Pays</th>
                <th>Devise</th>
                <th>Statut</th>
                <th>Admin</th>
                <th>Comptes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((row) => {
                const isOwnTenant = row.id === ownTenantId
                const suspended = row.status !== 'active'
                return (
                  <tr key={row.id}>
                    <td data-label="Nom">{row.name}</td>
                    <td data-label="Slug">{row.slug}</td>
                    <td data-label="Pays">{row.country}</td>
                    <td data-label="Devise">{row.currency}</td>
                    <td data-label="Statut"><span className={`badge ${suspended ? 'badge-red' : 'badge-green'}`}>{suspended ? 'Suspendu' : 'Actif'}</span></td>
                    <td data-label="Admin">{row.adminEmail ?? '—'}</td>
                    <td data-label="Comptes">{row.userCount}</td>
                    <td data-label="" style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={isOwnTenant || pendingId === row.id}
                        title={isOwnTenant ? 'Vous ne pouvez pas suspendre votre propre espace' : suspended ? 'Réactiver' : 'Suspendre'}
                        aria-label={`${suspended ? 'Réactiver' : 'Suspendre'} ${row.name}`}
                        onClick={() => toggleStatus(row)}
                      >
                        {suspended ? <Play size={14} /> : <Pause size={14} />}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!loading && tenants.length === 0 && <p className="table-empty">Aucun tenant pour l’instant.</p>}
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau tenant" subtitle="Provisionne un nouvel espace client isolé, avec son premier compte admin.">
        <NewTenantForm
          onCreated={() => {
            setModalOpen(false)
            setRefreshKey((key) => key + 1)
          }}
        />
      </Modal>
    </AppShell>
  )
}

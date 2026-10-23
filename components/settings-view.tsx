'use client'

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { LoadError } from '@/components/load-error'
import { fetchJson } from '@/lib/fetch-json'

type AppSettings = { companyName: string; companyShortName: string; country: string; currency: string }

// FCFA is the common screen label for both the UEMOA (XOF) and CEMAC (XAF) francs — intentionally
// not the ISO code, per the team's call that "XOF" would confuse clients who only know "FCFA".
const COUNTRY_OPTIONS = [
  { name: 'Guinée', currency: 'GNF' },
  { name: 'Sénégal', currency: 'FCFA' },
  { name: 'Côte d’Ivoire', currency: 'FCFA' },
  { name: 'Mali', currency: 'FCFA' },
  { name: 'Burkina Faso', currency: 'FCFA' },
  { name: 'Bénin', currency: 'FCFA' },
  { name: 'Togo', currency: 'FCFA' },
  { name: 'Niger', currency: 'FCFA' },
  { name: 'Djibouti', currency: 'DJF' },
]
const OTHER_COUNTRY = 'Autre'

export function SettingsView() {
  const router = useRouter()
  const [form, setForm] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [customCountry, setCustomCountry] = useState(false)

  useEffect(() => {
    fetchJson<{ settings: AppSettings }>('/api/parametres')
      .then((json) => {
        setForm(json.settings)
        setCustomCountry(!COUNTRY_OPTIONS.some((option) => option.name === json.settings.country))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue.'))
      .finally(() => setLoading(false))
  }, [])

  function handleCountryChange(value: string) {
    if (!form) return
    if (value === OTHER_COUNTRY) {
      setCustomCountry(true)
      setForm({ ...form, country: '' })
      return
    }
    setCustomCountry(false)
    const preset = COUNTRY_OPTIONS.find((option) => option.name === value)
    setForm({ ...form, country: value, currency: preset?.currency ?? form.currency })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!form) return
    setError('')
    setSaved(false)
    setSaving(true)
    try {
      const res = await fetch('/api/parametres', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      setSaved(true)
      // Re-render server components (sidebar, titles, invoice) with the fresh values.
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell breadcrumb="Pilotage" section="Paramètres">
      <section className="page-heading">
        <div>
          <p className="eyebrow">DÉMO</p>
          <h1>Paramètres <span>de l’application</span></h1>
          <p className="heading-subtitle">Nom de l’entreprise, pays et devise affichés dans toute l’application — utile pour re-thématiser la démo selon le prospect.</p>
        </div>
      </section>

      {error && <LoadError message={error} onRetry={() => setError('')} />}

      <div className="panel" style={{ maxWidth: 480 }}>
        {loading && <p className="section-subtitle">Chargement...</p>}
        {!loading && form && (
          <form onSubmit={handleSubmit}>
            <div className="form-field">
              <label>Nom de l’entreprise</label>
              <input required value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} placeholder="Ex : Barry-Gate Multi Service" />
            </div>
            <div className="form-field">
              <label>Sigle / nom court (sidebar, factures)</label>
              <input required value={form.companyShortName} onChange={(event) => setForm({ ...form, companyShortName: event.target.value })} placeholder="Ex : BGM" />
            </div>
            <div className="form-row">
              <div className="form-field">
                <label>Pays</label>
                <select required value={customCountry ? OTHER_COUNTRY : form.country} onChange={(event) => handleCountryChange(event.target.value)}>
                  <option value="" disabled>Sélectionner...</option>
                  {COUNTRY_OPTIONS.map((option) => <option key={option.name} value={option.name}>{option.name}</option>)}
                  <option value={OTHER_COUNTRY}>Autre</option>
                </select>
              </div>
              <div className="form-field">
                <label>Devise</label>
                <input required value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} placeholder="Ex : GNF, FCFA, DJF" maxLength={6} readOnly={!customCountry} disabled={!customCountry} />
              </div>
            </div>
            {customCountry && (
              <div className="form-field">
                <label>Nom du pays</label>
                <input required value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} placeholder="Ex : Mauritanie" />
              </div>
            )}
            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={saving}>
                <Save size={14} /> {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              {saved && <span className="section-subtitle" style={{ color: 'var(--green)' }}>Enregistré</span>}
            </div>
          </form>
        )}
      </div>
    </AppShell>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { LoadError } from '@/components/load-error'
import { fetchJson } from '@/lib/fetch-json'
import { COUNTRY_OPTIONS, OTHER_COUNTRY, currencyForCountry, isKnownCountry } from '@/lib/countries'

type AppSettings = {
  companyName: string
  companyShortName: string
  country: string
  currency: string
  companyAddress: string | null
  companyPhone: string | null
  companyEmail: string | null
  logoDataUrl: string | null
  unitBaseSingular: string | null
  unitBasePlural: string | null
  unitBulkSingular: string | null
  unitBulkPlural: string | null
  unitConversionMode: 'weight' | 'count' | null
  unitBulkConversionFactor: number | null
}

const MAX_LOGO_DIMENSION = 320

function resizeImageToDataUrl(file: File, maxDim: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Image invalide.'))
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Rendu impossible.'))
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}


export function SettingsView() {
  const router = useRouter()
  const [form, setForm] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [customCountry, setCustomCountry] = useState(false)
  const [logoError, setLogoError] = useState('')

  useEffect(() => {
    fetchJson<{ settings: AppSettings }>('/api/parametres')
      .then((json) => {
        setForm(json.settings)
        setCustomCountry(!isKnownCountry(json.settings.country))
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
    setForm({ ...form, country: value, currency: currencyForCountry(value) ?? form.currency })
  }

  async function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !form) return
    setLogoError('')
    if (!file.type.startsWith('image/')) {
      setLogoError('Le logo doit être une image (PNG, JPG...).')
      return
    }
    try {
      const dataUrl = await resizeImageToDataUrl(file, MAX_LOGO_DIMENSION)
      setForm({ ...form, logoDataUrl: dataUrl })
    } catch {
      setLogoError('Impossible de lire cette image.')
    }
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
              <label>Logo</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.logoDataUrl || '/api/logo'} alt="Logo actuel" style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--border, #e3e9f1)' }} />
                <div>
                  <input type="file" accept="image/*" onChange={handleLogoChange} />
                  {form.logoDataUrl && (
                    <button type="button" className="item-add-link" style={{ fontSize: 11, marginTop: 4 }} onClick={() => setForm({ ...form, logoDataUrl: null })}>
                      Revenir au logo par défaut
                    </button>
                  )}
                </div>
              </div>
              {logoError && <p className="form-error" style={{ marginTop: 6 }}>{logoError}</p>}
            </div>
            <div className="form-field">
              <label>Nom de l’entreprise</label>
              <input required value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} placeholder="Ex : SAAL Multi Services" />
            </div>
            <div className="form-field">
              <label>Sigle / nom court (sidebar, factures)</label>
              <input required value={form.companyShortName} onChange={(event) => setForm({ ...form, companyShortName: event.target.value })} placeholder="Ex : SAAL" />
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
            <div className="form-field">
              <label>Adresse (sur les factures)</label>
              <input value={form.companyAddress ?? ''} onChange={(event) => setForm({ ...form, companyAddress: event.target.value })} placeholder="Ex : Madina Marché, Conakry" />
            </div>
            <div className="form-row">
              <div className="form-field">
                <label>Téléphone (sur les factures)</label>
                <input value={form.companyPhone ?? ''} onChange={(event) => setForm({ ...form, companyPhone: event.target.value })} placeholder="Ex : 629 59 09 64" />
              </div>
              <div className="form-field">
                <label>E-mail (sur les factures)</label>
                <input type="email" value={form.companyEmail ?? ''} onChange={(event) => setForm({ ...form, companyEmail: event.target.value })} placeholder="Ex : contact@entreprise.com" />
              </div>
            </div>
            <div className="form-field" style={{ marginTop: 10, paddingTop: 16, borderTop: '1px solid var(--border, #e3e9f1)' }}>
              <label style={{ fontWeight: 700 }}>Unités de mesure</label>
              <p className="section-subtitle" style={{ marginTop: 2 }}>
                Comment un produit se vend à l’unité (ex : "Pièce") et en gros (ex : "Carton"). Laissez vide pour garder les valeurs par défaut ("Sac"/"Tonne").
              </p>
            </div>
            <div className="form-row">
              <div className="form-field">
                <label>Unité de base — singulier</label>
                <input value={form.unitBaseSingular ?? ''} onChange={(event) => setForm({ ...form, unitBaseSingular: event.target.value || null })} placeholder="Ex : Sac, Pièce, Kg" />
              </div>
              <div className="form-field">
                <label>Unité de base — pluriel</label>
                <input value={form.unitBasePlural ?? ''} onChange={(event) => setForm({ ...form, unitBasePlural: event.target.value || null })} placeholder="Ex : Sacs, Pièces, Kg" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-field">
                <label>Unité groupée — singulier</label>
                <input value={form.unitBulkSingular ?? ''} onChange={(event) => setForm({ ...form, unitBulkSingular: event.target.value || null })} placeholder="Ex : Tonne, Carton" />
              </div>
              <div className="form-field">
                <label>Unité groupée — pluriel</label>
                <input value={form.unitBulkPlural ?? ''} onChange={(event) => setForm({ ...form, unitBulkPlural: event.target.value || null })} placeholder="Ex : Tonnes, Cartons" />
              </div>
            </div>
            <div className="form-field">
              <label>Mode de conversion</label>
              <select value={form.unitConversionMode ?? 'weight'} onChange={(event) => setForm({ ...form, unitConversionMode: event.target.value as 'weight' | 'count' })}>
                <option value="weight">Par poids — ex : tonnage ÷ poids d’un sac = nombre de sacs</option>
                <option value="count">Par comptage — ex : nombre de cartons × pièces par carton = nombre de pièces</option>
              </select>
              <p className="section-subtitle" style={{ marginTop: 4 }}>
                Le champ "poids du {(form.unitBaseSingular ?? 'sac').toLowerCase()}" sur chaque produit change de sens selon le mode : un poids (kg) en mode "par poids", ou un nombre d’unités de base par unité groupée en mode "par comptage".
              </p>
            </div>
            {(form.unitConversionMode ?? 'weight') === 'weight' && (
              <div className="form-field">
                <label>Facteur de conversion (ex : 1000 pour kg par tonne)</label>
                <input type="number" min="0.000001" step="any" value={form.unitBulkConversionFactor ?? ''} onChange={(event) => setForm({ ...form, unitBulkConversionFactor: event.target.value ? Number(event.target.value) : null })} placeholder="Ex : 1000" />
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

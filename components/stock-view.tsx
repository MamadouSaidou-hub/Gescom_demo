'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, ChevronDown, ClipboardCheck, Layers, Package, PackagePlus, Plus, Search, Store, Truck, Upload, Wallet } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { downloadCsv } from '@/lib/download-csv'
import { fetchJson } from '@/lib/fetch-json'
import { Modal } from '@/components/modal'
import { LoadError } from '@/components/load-error'
import { useSettings } from '@/components/settings-provider'
import { SkeletonCards } from '@/components/skeleton'

type StockItem = {
  productId: number
  name: string
  sku: string
  category: string
  store: string
  quantity: number
  threshold: number
  unitPrice: string
  unitPriceRaw: number
  costPriceRaw: number
  status: 'critical' | 'low' | 'ok'
}

type StoreBreakdown = { store: string; quantity: number; threshold: number; status: 'critical' | 'low' | 'ok' }
type SupplierDelivery = {
  supplierName: string
  store: string
  sackCount: number
  tonnage: number | null
  totalAmountFormatted: string
  reference: string | null
  createdAt: string
}
type StockProduct = {
  productId: number
  name: string
  sku: string
  category: string
  unitPrice: string
  unitPriceRaw: number
  costPriceRaw: number
  unitSingular: string
  unitPlural: string
  totalQuantity: number
  status: 'critical' | 'low' | 'ok'
  stores: StoreBreakdown[]
  deliveries: SupplierDelivery[]
}

type StockData = {
  items: StockItem[]
  products: StockProduct[]
  summary: { totalArticles: number; totalQuantity: number; lowCount: number; stockValue: string }
  stores: string[]
}

type StoreOption = { id: number; name: string }
type ProductOption = { id: number; name: string; sku: string }
type StockCountRow = { id: number; productName: string; sku: string; storeName: string; theoreticalQty: number; countedQty: number; variance: number; createdAt: string }

const statusLabel = { ok: 'OK', low: 'Faible', critical: 'Critique' }
const statusBadge = { ok: 'badge-green', low: 'badge-orange', critical: 'badge-red' }

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Package; tone: 'navy' | 'green' | 'orange' | 'blue' }) {
  return (
    <article className="metric-card">
      <div className="metric-topline"><span className={`metric-icon metric-icon-${tone}`}><Icon aria-hidden="true" /></span></div>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </article>
  )
}

function NewProductForm({ storeOptions, onCreated }: { storeOptions: StoreOption[]; onCreated: () => void }) {
  const { currency, unitBaseSingular, unitBasePlural } = useSettings()
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [customSku, setCustomSku] = useState(false)
  const [category, setCategory] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [reorderThreshold, setReorderThreshold] = useState('10')
  const [storeId, setStoreId] = useState('')
  const [initialQuantity, setInitialQuantity] = useState('0')
  const [unitSingular, setUnitSingular] = useState(unitBaseSingular)
  const [unitPlural, setUnitPlural] = useState(unitBasePlural)
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
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sku, category, unitPrice, costPrice, reorderThreshold, storeId, initialQuantity, unitSingular, unitPlural }),
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
      <div className="form-field"><label>Nom de l’article</label><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex : Riz parfumé 25kg" /></div>
      <div className="form-field">
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Catégorie</span>
          <button type="button" className="item-add-link" style={{ fontSize: 11 }} onClick={() => setCustomSku((value) => !value)}>
            {customSku ? 'Annuler' : 'Personnaliser le SKU'}
          </button>
        </label>
        <input required value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Épicerie" />
      </div>
      {customSku && (
        <div className="form-field">
          <label>SKU</label>
          <input value={sku} onChange={(event) => setSku(event.target.value)} placeholder="Laisser vide pour un SKU généré automatiquement" />
        </div>
      )}
      <div className="form-row">
        <div className="form-field"><label>Prix de vente ({currency})</label><input required type="number" min="0" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} /></div>
        <div className="form-field"><label>Prix d’achat ({currency})</label><input required type="number" min="0" value={costPrice} onChange={(event) => setCostPrice(event.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Seuil d’alerte</label><input required type="number" min="0" value={reorderThreshold} onChange={(event) => setReorderThreshold(event.target.value)} /></div>
        <div className="form-field"><label>Quantité initiale</label><input required type="number" min="0" value={initialQuantity} onChange={(event) => setInitialQuantity(event.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-field">
          <label>Unité (singulier)</label>
          <input required value={unitSingular} onChange={(event) => setUnitSingular(event.target.value)} placeholder="Ex : Bouteille, Carton, Pièce" />
        </div>
        <div className="form-field">
          <label>Unité (pluriel)</label>
          <input required value={unitPlural} onChange={(event) => setUnitPlural(event.target.value)} placeholder="Ex : Bouteilles, Cartons, Pièces" />
        </div>
      </div>
      <div className="form-field">
        <label>Magasin de départ</label>
        <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Création...' : 'Créer l’article'}</button></div>
    </form>
  )
}

function ImportProductsForm({ storeOptions, onImported }: { storeOptions: StoreOption[]; onImported: () => void }) {
  const [storeId, setStoreId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: { row: number; reason: string }[] } | null>(null)

  useEffect(() => {
    if (!storeId && storeOptions.length > 0) setStoreId(String(storeOptions[0].id))
  }, [storeOptions, storeId])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!file) {
      setError('Choisissez un fichier .csv ou .xlsx.')
      return
    }
    setError('')
    setResult(null)
    setSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('storeId', storeId)
      const res = await fetch('/api/products/import', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      setResult(json)
      onImported()
    } catch {
      setError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}
      <p className="section-subtitle">
        Fichier .csv ou .xlsx avec les colonnes : <strong>Code-barres</strong> (optionnel), <strong>Nom</strong>, <strong>Catégorie</strong>,{' '}
        <strong>Prix d’achat</strong>, <strong>Prix de vente</strong>, <strong>Stock initial</strong> (optionnel), <strong>Seuil d’alerte</strong> (optionnel),{' '}
        <strong>Unité</strong> (optionnel, ex : Bouteille, Carton, Pièce — par défaut "Sac").
      </p>
      <div className="form-field">
        <label>Magasin cible (pour le stock initial)</label>
        <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </div>
      <div className="form-field">
        <label>Fichier</label>
        <input required type="file" accept=".csv,.xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Import...' : 'Importer'}</button></div>

      {result && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border, #e3e9f1)' }}>
          <p style={{ fontWeight: 700, color: 'var(--green, #2e9e3f)' }}>{result.imported} produit(s) importé(s).</p>
          {result.skipped.length > 0 && (
            <>
              <p style={{ fontWeight: 700, color: 'var(--red, #d1453d)', marginTop: 8 }}>{result.skipped.length} ligne(s) ignorée(s) :</p>
              <ul style={{ fontSize: 12, color: 'var(--muted)', paddingLeft: 18 }}>
                {result.skipped.map((s, index) => <li key={index}>Ligne {s.row} : {s.reason}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </form>
  )
}

function EditPriceForm({ item, onSaved }: { item: StockProduct; onSaved: () => void }) {
  const { currency } = useSettings()
  const [unitPrice, setUnitPrice] = useState(String(item.unitPriceRaw))
  const [costPrice, setCostPrice] = useState(String(item.costPriceRaw))
  const [unitSingular, setUnitSingular] = useState(item.unitSingular)
  const [unitPlural, setUnitPlural] = useState(item.unitPlural)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/products/${item.productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitPrice, costPrice, unitSingular, unitPlural }),
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
      <p className="section-title" style={{ marginBottom: 8 }}>Prix</p>
      <div className="form-row">
        <div className="form-field"><label>Prix de vente ({currency})</label><input required type="number" min="0" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} /></div>
        <div className="form-field"><label>Prix de revient ({currency})</label><input required type="number" min="0" value={costPrice} onChange={(event) => setCostPrice(event.target.value)} /></div>
      </div>
      <p className="section-subtitle">Le nouveau prix de revient s’applique aux prochaines ventes. Les ventes déjà enregistrées gardent leur marge d’origine.</p>
      <p className="section-title" style={{ marginBottom: 8, marginTop: 16 }}>Unité</p>
      <div className="form-row">
        <div className="form-field"><label>Singulier</label><input required value={unitSingular} onChange={(event) => setUnitSingular(event.target.value)} placeholder="Ex : Bouteille" /></div>
        <div className="form-field"><label>Pluriel</label><input required value={unitPlural} onChange={(event) => setUnitPlural(event.target.value)} placeholder="Ex : Bouteilles" /></div>
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer'}</button></div>
    </form>
  )
}

function StockReceptionForm({ storeOptions, productOptions, onCreated }: { storeOptions: StoreOption[]; productOptions: ProductOption[]; onCreated: () => void }) {
  const [productId, setProductId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!productId && productOptions.length > 0) setProductId(String(productOptions[0].id))
  }, [productOptions, productId])
  useEffect(() => {
    if (!storeId && storeOptions.length > 0) setStoreId(String(storeOptions[0].id))
  }, [storeOptions, storeId])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, storeId, quantity, reference }),
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
      <p className="section-subtitle">
        Pour une livraison d’un fournisseur enregistré (dette, paiement, historique), utilisez plutôt{' '}
        <strong>Fournisseurs → Livraison</strong>. Ce formulaire-ci ajoute juste une quantité au stock, sans lien fournisseur — utile pour un retour, une correction, ou un apport hors fournisseur suivi.
      </p>
      <div className="form-field">
        <label>Article</label>
        <select required value={productId} onChange={(event) => setProductId(event.target.value)}>
          {productOptions.map((option) => <option key={option.id} value={option.id}>{option.name} ({option.sku})</option>)}
        </select>
      </div>
      <div className="form-row">
        <div className="form-field">
          <label>Magasin</label>
          <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
            {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </div>
        <div className="form-field"><label>Quantité reçue</label><input required type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
      </div>
      <div className="form-field"><label>Référence (optionnel)</label><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Ex : bon de retour, note interne..." /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer la réception'}</button></div>
    </form>
  )
}

function StockCountForm({
  storeOptions,
  productOptions,
  stockItems,
  onCreated,
}: {
  storeOptions: StoreOption[]
  productOptions: ProductOption[]
  stockItems: StockItem[]
  onCreated: () => void
}) {
  const [productId, setProductId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [countedQty, setCountedQty] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!productId && productOptions.length > 0) setProductId(String(productOptions[0].id))
  }, [productOptions, productId])
  useEffect(() => {
    if (!storeId && storeOptions.length > 0) setStoreId(String(storeOptions[0].id))
  }, [storeOptions, storeId])

  const selectedProduct = productOptions.find((option) => String(option.id) === productId)
  const selectedStore = storeOptions.find((option) => String(option.id) === storeId)
  const theoreticalItem = stockItems.find((item) => item.sku === selectedProduct?.sku && item.store === selectedStore?.name)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/stock/count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, storeId, countedQty }),
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
      <p className="section-subtitle">
        Remplace la quantité système par ce que vous avez réellement compté dans le magasin — contrairement à une réception,
        qui s’ajoute au stock existant. L’écart (vol, erreur, casse non enregistrée...) est automatiquement calculé et tracé.
      </p>
      <div className="form-field">
        <label>Article</label>
        <select required value={productId} onChange={(event) => setProductId(event.target.value)}>
          {productOptions.map((option) => <option key={option.id} value={option.id}>{option.name} ({option.sku})</option>)}
        </select>
      </div>
      <div className="form-field">
        <label>Magasin</label>
        <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </div>
      {theoreticalItem && <p className="section-subtitle">Quantité théorique actuelle : <strong>{theoreticalItem.quantity}</strong></p>}
      <div className="form-field"><label>Quantité comptée</label><input required type="number" min="0" value={countedQty} onChange={(event) => setCountedQty(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer le comptage'}</button></div>
    </form>
  )
}

export function StockView() {
  const [store, setStore] = useState('Tous les magasins')
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [statusFilter, setStatusFilter] = useState<'all' | StockProduct['status']>('all')
  const [data, setData] = useState<StockData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([])
  const [productOptions, setProductOptions] = useState<ProductOption[]>([])
  const [productModalOpen, setProductModalOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [receptionModalOpen, setReceptionModalOpen] = useState(false)
  const [countModalOpen, setCountModalOpen] = useState(false)
  const [detailProduct, setDetailProduct] = useState<StockProduct | null>(null)
  const [counts, setCounts] = useState<StockCountRow[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ store })
    fetchJson<StockData>(`/api/stock?${params.toString()}`)
      .then((json) => {
        if (!cancelled) setData(json)
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
  }, [store, refreshKey])

  useEffect(() => {
    fetchJson<{ stores: StoreOption[] }>('/api/magasins').then((json) => setStoreOptions(json.stores)).catch(() => {})
    fetchJson<{ products: ProductOption[] }>('/api/products').then((json) => setProductOptions(json.products)).catch(() => {})
  }, [refreshKey])

  useEffect(() => {
    const params = new URLSearchParams({ store })
    fetchJson<{ counts: StockCountRow[] }>(`/api/stock/count?${params.toString()}`)
      .then((json) => setCounts(json.counts ?? []))
      .catch(() => {})
  }, [store, refreshKey])

  const stores = data?.stores ?? ['Tous les magasins']
  const filteredProducts = useMemo(() => {
    let productList = data?.products ?? []
    if (statusFilter !== 'all') productList = productList.filter((product) => product.status === statusFilter)
    const query = search.trim().toLowerCase()
    if (!query) return productList
    return productList.filter(
      (product) => product.name.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query) || product.category.toLowerCase().includes(query),
    )
  }, [data, search, statusFilter])

  function refreshData() {
    setRefreshKey((key) => key + 1)
  }

  function refresh() {
    setProductModalOpen(false)
    setReceptionModalOpen(false)
    setCountModalOpen(false)
    refreshData()
  }

  return (
    <AppShell breadcrumb="Gestion" section="Stock" onExport={() => downloadCsv(`/api/stock?${new URLSearchParams({ store, format: 'csv' }).toString()}`, 'stock.csv')}>
      <section className="page-heading">
        <div><p className="eyebrow">INVENTAIRE</p><h1>Stock <span>par magasin</span></h1><p className="heading-subtitle">Suivez les niveaux de stock et les articles à réapprovisionner.</p></div>
        <div className="filter-row">
          <label className="select-wrap"><span className="sr-only">Magasin</span><select value={store} onChange={(event) => setStore(event.target.value)}>{stores.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown /></label>
        </div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      <section className="metrics-grid" aria-label="Indicateurs stock">
        {loading ? <SkeletonCards count={4} /> : (
          <>
            <MetricCard label="Articles référencés" value={`${data?.summary.totalArticles ?? 0}`} icon={Package} tone="navy" />
            <MetricCard label="Quantité totale" value={`${data?.summary.totalQuantity ?? 0}`} icon={Layers} tone="blue" />
            <MetricCard label="Articles en alerte" value={`${data?.summary.lowCount ?? 0}`} icon={AlertTriangle} tone="orange" />
            <MetricCard label="Valeur du stock" value={data?.summary.stockValue ?? '—'} icon={Wallet} tone="green" />
          </>
        )}
      </section>

      <div className="toolbar-panel">
        <div className="toolbar-search">
          <Search aria-hidden="true" />
          <input placeholder="Rechercher un article, une référence..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Rechercher un article" />
        </div>
        <button className="btn-secondary" onClick={() => setImportModalOpen(true)}><Upload size={14} /> Importer un catalogue</button>
        <button className="btn-secondary" onClick={() => setReceptionModalOpen(true)}><PackagePlus size={14} /> Réception stock</button>
        <button className="btn-secondary" onClick={() => setCountModalOpen(true)}><ClipboardCheck size={14} /> Comptage physique</button>
        <button className="btn-primary" onClick={() => setProductModalOpen(true)}><Plus size={14} /> Nouvel article</button>
      </div>

      <div className="filter-chip-row" role="group" aria-label="Filtrer par statut">
        <button type="button" className={`filter-chip ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>Tous</button>
        <button type="button" className={`filter-chip ${statusFilter === 'critical' ? 'active' : ''}`} onClick={() => setStatusFilter('critical')}>Critique</button>
        <button type="button" className={`filter-chip ${statusFilter === 'low' ? 'active' : ''}`} onClick={() => setStatusFilter('low')}>Faible</button>
        <button type="button" className={`filter-chip ${statusFilter === 'ok' ? 'active' : ''}`} onClick={() => setStatusFilter('ok')}>OK</button>
      </div>

      <div className="store-card-grid">
        {loading && Array.from({ length: 6 }).map((_, index) => (
          <article className="store-card skeleton-card" key={index}>
            <div className="store-card-head">
              <span className="skeleton-block" style={{ width: 36, height: 36, borderRadius: 9 }} />
              <div style={{ flex: 1 }}>
                <span className="skeleton-block" style={{ width: '70%', height: 13 }} />
                <span className="skeleton-block" style={{ width: '50%', height: 10, marginTop: 6 }} />
              </div>
            </div>
          </article>
        ))}
        {!loading && filteredProducts.map((product) => (
          <article className="store-card clickable-row" key={product.productId} onClick={() => setDetailProduct(product)}>
            <div className="store-card-head">
              <span className="store-card-icon"><Package aria-hidden="true" /></span>
              <div><strong>{product.name}</strong><span>{product.sku} · {product.category}</span></div>
            </div>
            <div className="store-card-stats">
              <div><label><Wallet size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Prix unitaire</label><b>{product.unitPrice}</b></div>
              <div><label><Layers size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Quantité totale</label><b>{product.totalQuantity}</b></div>
              <div><label><Store size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Magasins</label><b>{product.stores.length}</b></div>
              <div><label><AlertTriangle size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Statut</label><b><span className={`badge ${statusBadge[product.status]}`}>{statusLabel[product.status]}</span></b></div>
            </div>
          </article>
        ))}
        {!loading && filteredProducts.length === 0 && <p className="table-empty">Aucun article ne correspond à votre recherche.</p>}
      </div>

      {counts.length > 0 && (
        <div className="table-panel" style={{ marginTop: 20 }}>
          <div className="table-scroll">
            <p className="section-title" style={{ padding: '16px 18px 0' }}>Écarts récents</p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Produit</th>
                  <th>Magasin</th>
                  <th>Théorique</th>
                  <th>Compté</th>
                  <th>Écart</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Date">{new Date(row.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td data-label="Produit">{row.productName} ({row.sku})</td>
                    <td data-label="Magasin">{row.storeName}</td>
                    <td data-label="Théorique">{row.theoreticalQty}</td>
                    <td data-label="Compté">{row.countedQty}</td>
                    <td data-label="Écart" style={{ color: row.variance === 0 ? undefined : row.variance > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{row.variance > 0 ? `+${row.variance}` : row.variance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={countModalOpen} onClose={() => setCountModalOpen(false)} title="Comptage physique" subtitle="Comparez le stock compté au stock théorique et ajustez le système.">
        <StockCountForm storeOptions={storeOptions} productOptions={productOptions} stockItems={data?.items ?? []} onCreated={refresh} />
      </Modal>

      <Modal open={productModalOpen} onClose={() => setProductModalOpen(false)} title="Nouvel article" subtitle="Ajoutez un article au catalogue et son stock de départ.">
        <NewProductForm storeOptions={storeOptions} onCreated={refresh} />
      </Modal>
      <Modal open={importModalOpen} onClose={() => setImportModalOpen(false)} title="Importer un catalogue" subtitle="Créez plusieurs articles d’un coup depuis un fichier." wide>
        <ImportProductsForm storeOptions={storeOptions} onImported={refreshData} />
      </Modal>
      <Modal open={receptionModalOpen} onClose={() => setReceptionModalOpen(false)} title="Réception stock" subtitle="Enregistrez l’arrivée d’articles dans un magasin.">
        <StockReceptionForm storeOptions={storeOptions} productOptions={productOptions} onCreated={refresh} />
      </Modal>
      <Modal open={detailProduct !== null} onClose={() => setDetailProduct(null)} title={detailProduct?.name ?? ''} subtitle={detailProduct ? `${detailProduct.sku} · ${detailProduct.category}` : ''} wide>
        {detailProduct && (
          <div style={{ display: 'grid', gap: 22 }}>
            <EditPriceForm item={detailProduct} onSaved={() => { refresh(); setDetailProduct(null) }} />
            <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'minmax(220px, 1fr) minmax(280px, 2fr)' }}>
              <div>
                <p className="section-title" style={{ marginBottom: 8 }}>Par magasin</p>
                <table className="data-table">
                  <thead><tr><th>Magasin</th><th>Qté</th><th>Seuil</th><th>Statut</th></tr></thead>
                  <tbody>
                    {detailProduct.stores.map((s) => (
                      <tr key={s.store}>
                        <td data-label="Magasin">{s.store}</td>
                        <td data-label="Qté">{s.quantity}</td>
                        <td data-label="Seuil">{s.threshold}</td>
                        <td data-label="Statut"><span className={`badge ${statusBadge[s.status]}`}>{statusLabel[s.status]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <p className="section-title" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Truck size={13} /> Historique fournisseurs
                </p>
                {detailProduct.deliveries.length === 0 ? (
                  <p className="table-empty">Aucune livraison enregistrée pour ce produit.</p>
                ) : (
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Fournisseur</th><th>Magasin</th><th>Qté</th><th>Montant</th></tr></thead>
                    <tbody>
                      {detailProduct.deliveries.map((d, index) => (
                        <tr key={index}>
                          <td data-label="Date">{new Date(d.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                          <td data-label="Fournisseur">{d.supplierName}</td>
                          <td data-label="Magasin">{d.store}</td>
                          <td data-label="Qté">{d.sackCount}{d.tonnage ? ` (${d.tonnage} t)` : ''}</td>
                          <td data-label="Montant">{d.totalAmountFormatted}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  )
}

import { businessConfig } from './business-config'

// Defaults to the static GNF config only when a caller doesn't pass a currency — every per-tenant
// query should pass the tenant's own currency instead (see makeFormatFcfa below), since this is a
// multi-tenant app and a tenant configured for e.g. FCFA should never see "GNF" on their amounts.
export function formatFcfa(value: number, currency: string = businessConfig.currency) {
  return `${Math.round(value).toLocaleString('fr-FR')} ${currency}`
}

/** Binds formatFcfa to one tenant's currency so existing `formatFcfa(x)` call sites inside a query
 * function keep working unchanged after shadowing the top-level import with this local version —
 * `const formatFcfa = makeFormatFcfa(branding.currency)` at the top of the function is the only
 * change needed per file. */
export function makeFormatFcfa(currency: string) {
  return (value: number) => formatFcfa(value, currency)
}

export function pctChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100
  return ((current - previous) / previous) * 100
}

export function formatTrend(pct: number) {
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1).replace('.', ',')} %`
}

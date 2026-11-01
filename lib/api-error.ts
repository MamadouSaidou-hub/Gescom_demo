type PgErrorLike = { code?: string; constraint?: string }

/**
 * Drizzle/node-postgres wrap the real Postgres error on `.cause` (sometimes nested one level
 * deeper) — `error.message` at the top is just "Failed query: <sql> params: <...>", never the
 * actual constraint violation. Matching on `error.message` text (as this file used to, and as
 * individual routes sometimes do for a friendlier message) silently never matches anything real.
 * Walk `.cause` to find the actual pg error, identified by its 5-digit SQLSTATE `code`.
 */
function findPgError(error: unknown): PgErrorLike | null {
  let current: unknown = error
  for (let hop = 0; hop < 5 && current; hop++) {
    if (typeof current === 'object' && current !== null && 'code' in current) {
      const code = (current as { code?: unknown }).code
      if (typeof code === 'string' && /^\d{5}$/.test(code)) return current as PgErrorLike
    }
    current = (current as { cause?: unknown } | null)?.cause
  }
  return null
}

/** The violated constraint's name (e.g. "tenants_slug_key"), for a route that wants a specific
 * message per constraint rather than the generic ones below. */
export function pgConstraintName(error: unknown): string | null {
  return findPgError(error)?.constraint ?? null
}

export function toApiErrorMessage(error: unknown): string {
  const pgError = findPgError(error)
  // https://www.postgresql.org/docs/current/errcodes-appendix.html
  if (pgError?.code === '23505') return 'Cette valeur existe déjà (référence en doublon).'
  if (pgError?.code === '23503') return 'Référence invalide (élément introuvable).'
  if (pgError?.code === '23502') return 'Un champ obligatoire est manquant.'

  const message = error instanceof Error ? error.message : ''
  return message || 'Erreur inconnue.'
}

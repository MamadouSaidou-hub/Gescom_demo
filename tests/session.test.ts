import { describe, expect, it } from 'vitest'
import { effectiveStoreParam, isAdmin, scopedStoreList, type SessionContext } from '@/lib/session'

function ctx(overrides: Partial<SessionContext> = {}): SessionContext {
  return { userId: 'u1', email: 'u1@test.local', role: 'gestionnaire', tenantId: 1, storeId: null, storeName: null, platformAdmin: false, permissions: [], ...overrides }
}

describe('isAdmin', () => {
  it('is true only for the admin role', () => {
    expect(isAdmin(ctx({ role: 'admin' }))).toBe(true)
    expect(isAdmin(ctx({ role: 'gestionnaire' }))).toBe(false)
  })
})

describe('effectiveStoreParam', () => {
  it('lets an admin request any store', () => {
    expect(effectiveStoreParam(ctx({ role: 'admin' }), 'SAAL Ratoma')).toBe('SAAL Ratoma')
    expect(effectiveStoreParam(ctx({ role: 'admin' }), null)).toBeNull()
  })

  it('forces a gestionnaire to their own store, ignoring the request', () => {
    const gestionnaire = ctx({ role: 'gestionnaire', storeName: 'SAAL Kaloum' })
    expect(effectiveStoreParam(gestionnaire, 'SAAL Ratoma')).toBe('SAAL Kaloum')
    expect(effectiveStoreParam(gestionnaire, null)).toBe('SAAL Kaloum')
  })
})

describe('scopedStoreList', () => {
  it('gives an admin every store plus the "all stores" option', () => {
    const admin = ctx({ role: 'admin' })
    expect(scopedStoreList(admin, ['SAAL Kaloum', 'SAAL Ratoma'])).toEqual(['Tous les magasins', 'SAAL Kaloum', 'SAAL Ratoma'])
  })

  it('restricts a gestionnaire to only their own store', () => {
    const gestionnaire = ctx({ role: 'gestionnaire', storeName: 'SAAL Kaloum' })
    expect(scopedStoreList(gestionnaire, ['SAAL Kaloum', 'SAAL Ratoma'])).toEqual(['SAAL Kaloum'])
  })

  it('gives a gestionnaire with no assigned store an empty list', () => {
    const gestionnaire = ctx({ role: 'gestionnaire', storeName: null })
    expect(scopedStoreList(gestionnaire, ['SAAL Kaloum', 'SAAL Ratoma'])).toEqual([])
  })
})

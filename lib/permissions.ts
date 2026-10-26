/**
 * Feature permissions a tenant admin can grant to a "gestionnaire" account individually, instead
 * of the old all-or-nothing admin/gestionnaire split. Deliberately does NOT include user
 * management: better-auth's admin plugin (setRole/removeUser/createUser/setUserPassword) checks
 * the caller's role against `adminRoles: ['admin']` internally — that's better-auth's own access
 * control, not this app's, and isn't something a per-permission flag can override without
 * replacing the plugin's role model entirely. Managing other accounts stays tied to the
 * `role` column (the "Administrateur" toggle), unchanged.
 */
export const PERMISSIONS = ['products', 'stores', 'suppliers', 'treasury', 'discounts', 'reports', 'transfers'] as const

export type Permission = (typeof PERMISSIONS)[number]

export const permissionLabel: Record<Permission, string> = {
  products: 'Produits & prix',
  stores: 'Magasins',
  suppliers: 'Fournisseurs',
  treasury: 'Caisse & Trésorerie',
  discounts: 'Remises & barèmes',
  reports: 'Rapports & marges',
  transfers: 'Transferts entre magasins',
}

export const permissionHelp: Record<Permission, string> = {
  products: 'Créer des produits et modifier leurs prix.',
  stores: 'Créer de nouveaux magasins.',
  suppliers: 'Gérer les fournisseurs, livraisons et paiements.',
  treasury: 'Voir et gérer les caisses, dépenses et la trésorerie.',
  discounts: 'Définir les barèmes de remise clients/fournisseurs.',
  reports: 'Consulter les rapports et marges.',
  transfers: 'Créer et recevoir des transferts entre magasins.',
}

export function parsePermissions(raw: string | null | undefined): Permission[] {
  if (!raw) return []
  return raw.split(',').filter((value): value is Permission => (PERMISSIONS as readonly string[]).includes(value))
}

export function serializePermissions(permissions: string[]): string {
  return permissions.filter((value): value is Permission => (PERMISSIONS as readonly string[]).includes(value)).join(',')
}

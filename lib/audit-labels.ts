/**
 * Kept separate from lib/audit.ts so client components can import the labels without pulling the
 * database client into the browser bundle.
 *
 * Actions worth a permanent trace: anything that changes who can do what, removes an account, or
 * provisions/suspends a paying client. Deliberately a closed list — if it isn't here, it isn't
 * audited, and adding a case should be a conscious decision rather than an accident.
 */
export type AuditAction =
  | 'user.created'
  | 'user.role_changed'
  | 'user.deleted'
  | 'tenant.created'
  | 'tenant.suspended'
  | 'tenant.reactivated'

export const auditActionLabel: Record<AuditAction, string> = {
  'user.created': 'Compte créé',
  'user.role_changed': 'Rôle modifié',
  'user.deleted': 'Compte supprimé',
  'tenant.created': 'Client créé',
  'tenant.suspended': 'Client suspendu',
  'tenant.reactivated': 'Client réactivé',
}

import { and, eq, ne, sql } from 'drizzle-orm'
import { withTenant, type TenantTx } from '../tenant'
import { cashAccounts, cashAccountType, cashMovements, cashMovementType } from '../schema'

/**
 * Auto-records a cash movement for money that actually changed hands elsewhere (a sale payment, a
 * client settling a receivable, a supplier payment) — so the caisse balance reflects reality
 * without someone re-entering the same amount by hand. Every such movement goes through the single
 * "caisse principale" (cash_accounts.is_default), regardless of payment method or store — from
 * there, redistributing to other caisses is a manual transfer (see transferBetweenCashAccounts).
 * If no default caisse is configured yet, the oldest account is used as a fallback so money is
 * still tracked somewhere; if there's no caisse at all, the movement is simply skipped — this never
 * blocks the sale/payment itself from succeeding.
 */
export async function recordAutoCashMovement(
  tenantId: number,
  input: {
    direction: 'in' | 'out'
    amount: number
    storeId?: number | null
    category: string
    description?: string | null
  },
) {
  if (input.amount <= 0) return null

  return withTenant(tenantId, async (tx) => {
    const accounts = await tx.select().from(cashAccounts).where(eq(cashAccounts.tenantId, tenantId)).orderBy(cashAccounts.id)
    const account = accounts.find((row) => row.isDefault) ?? accounts[0]
    if (!account) return null

    return recordCashMovementTx(tx, tenantId, {
      cashAccountId: account.id,
      type: input.direction === 'in' ? 'deposit' : 'expense',
      category: input.category,
      description: input.description,
      amount: input.amount,
      storeId: input.storeId ?? null,
    })
  })
}

export async function setDefaultCashAccount(tenantId: number, id: number) {
  return withTenant(tenantId, async (tx) => {
    const [account] = await tx.select().from(cashAccounts).where(and(eq(cashAccounts.id, id), eq(cashAccounts.tenantId, tenantId)))
    if (!account) throw new Error('Caisse introuvable.')
    await tx.update(cashAccounts).set({ isDefault: false }).where(and(ne(cashAccounts.id, id), eq(cashAccounts.tenantId, tenantId)))
    const [updated] = await tx
      .update(cashAccounts)
      .set({ isDefault: true })
      .where(and(eq(cashAccounts.id, id), eq(cashAccounts.tenantId, tenantId)))
      .returning()
    return updated
  })
}

export async function transferBetweenCashAccounts(
  tenantId: number,
  input: { fromId: number; toId: number; amount: number; description?: string | null },
) {
  if (input.fromId === input.toId) {
    throw new Error('Choisissez deux caisses différentes.')
  }
  if (input.amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro.')
  }

  return withTenant(tenantId, async (tx) => {
    const [fromAccount] = await tx.select().from(cashAccounts).where(and(eq(cashAccounts.id, input.fromId), eq(cashAccounts.tenantId, tenantId)))
    const [toAccount] = await tx.select().from(cashAccounts).where(and(eq(cashAccounts.id, input.toId), eq(cashAccounts.tenantId, tenantId)))
    if (!fromAccount || !toAccount) {
      throw new Error('Caisse introuvable.')
    }

    await tx.insert(cashMovements).values([
      {
        cashAccountId: input.fromId,
        type: 'expense',
        category: 'Transfert interne',
        description: input.description ?? `Vers ${toAccount.name}`,
        amount: input.amount,
        tenantId,
      },
      {
        cashAccountId: input.toId,
        type: 'deposit',
        category: 'Transfert interne',
        description: input.description ?? `Depuis ${fromAccount.name}`,
        amount: input.amount,
        tenantId,
      },
    ])

    await tx
      .update(cashAccounts)
      .set({ balance: sql`${cashAccounts.balance} - ${input.amount}` })
      .where(and(eq(cashAccounts.id, input.fromId), eq(cashAccounts.tenantId, tenantId)))
    await tx
      .update(cashAccounts)
      .set({ balance: sql`${cashAccounts.balance} + ${input.amount}` })
      .where(and(eq(cashAccounts.id, input.toId), eq(cashAccounts.tenantId, tenantId)))

    return { fromId: input.fromId, toId: input.toId, amount: input.amount }
  })
}

export async function createCashAccount(
  tenantId: number,
  input: {
    name: string
    type: (typeof cashAccountType)[number]
    storeId?: number | null
    initialBalance: number
  },
) {
  return withTenant(tenantId, async (tx) => {
    const [account] = await tx
      .insert(cashAccounts)
      .values({
        name: input.name,
        type: input.type,
        balance: input.initialBalance,
        storeId: input.storeId ?? null,
        tenantId,
      })
      .returning()

    return account
  })
}

export async function recordCashMovement(
  tenantId: number,
  input: {
    cashAccountId: number
    type: (typeof cashMovementType)[number]
    category: string
    description?: string | null
    amount: number
    storeId?: number | null
  },
) {
  if (input.amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro.')
  }

  return withTenant(tenantId, async (tx) => recordCashMovementTx(tx, tenantId, input))
}

async function recordCashMovementTx(
  tx: TenantTx,
  tenantId: number,
  input: {
    cashAccountId: number
    type: (typeof cashMovementType)[number]
    category: string
    description?: string | null
    amount: number
    storeId?: number | null
  },
) {
  const [account] = await tx.select().from(cashAccounts).where(and(eq(cashAccounts.id, input.cashAccountId), eq(cashAccounts.tenantId, tenantId)))
  if (!account) {
    throw new Error('Caisse introuvable.')
  }

  const [movement] = await tx
    .insert(cashMovements)
    .values({
      cashAccountId: input.cashAccountId,
      storeId: input.storeId ?? null,
      type: input.type,
      category: input.category,
      description: input.description ?? null,
      amount: input.amount,
      tenantId,
    })
    .returning()

  const delta = input.type === 'deposit' ? input.amount : -input.amount
  await tx
    .update(cashAccounts)
    .set({ balance: sql`${cashAccounts.balance} + ${delta}` })
    .where(and(eq(cashAccounts.id, input.cashAccountId), eq(cashAccounts.tenantId, tenantId)))

  return movement
}

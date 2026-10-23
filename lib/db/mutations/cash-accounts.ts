import { eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { cashAccounts, cashAccountType, cashMovements, cashMovementType, paymentMethod } from '../schema'

const methodToAccountType: Record<(typeof paymentMethod)[number], (typeof cashAccountType)[number]> = {
  cash: 'cash',
  mobile_money: 'mobile_money',
  bank_transfer: 'bank',
  check: 'bank',
}

/**
 * Auto-records a cash movement for money that actually changed hands elsewhere (a sale payment, a
 * client settling a receivable, a supplier payment) — so the caisse balance reflects reality
 * without someone re-entering the same amount by hand. Resolution order for which account to use:
 * a store-scoped account of the matching type, then any global (storeId null) account of that
 * type, then any account of that type at all. If none exists yet, the movement is simply skipped
 * — this never blocks the sale/payment itself from succeeding (see the "où ça pêche" call: a
 * missing caisse config shouldn't stop the business from operating).
 */
export async function recordAutoCashMovement(input: {
  direction: 'in' | 'out'
  method: (typeof paymentMethod)[number]
  amount: number
  storeId?: number | null
  category: string
  description?: string | null
}) {
  if (input.amount <= 0) return null
  const accountType = methodToAccountType[input.method]

  const candidates = await db.select().from(cashAccounts).where(eq(cashAccounts.type, accountType))
  const account =
    (input.storeId ? candidates.find((row) => row.storeId === input.storeId) : undefined) ??
    candidates.find((row) => row.storeId === null) ??
    candidates[0]
  if (!account) return null

  return recordCashMovement({
    cashAccountId: account.id,
    type: input.direction === 'in' ? 'deposit' : 'expense',
    category: input.category,
    description: input.description,
    amount: input.amount,
    storeId: input.storeId ?? null,
  })
}

export async function createCashAccount(input: {
  name: string
  type: (typeof cashAccountType)[number]
  storeId?: number | null
  initialBalance: number
}) {
  const [account] = await db
    .insert(cashAccounts)
    .values({
      name: input.name,
      type: input.type,
      balance: input.initialBalance,
      storeId: input.storeId ?? null,
    })
    .returning()

  return account
}

export async function recordCashMovement(input: {
  cashAccountId: number
  type: (typeof cashMovementType)[number]
  category: string
  description?: string | null
  amount: number
  storeId?: number | null
}) {
  if (input.amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro.')
  }

  return db.transaction(async (tx) => {
    const [account] = await tx.select().from(cashAccounts).where(eq(cashAccounts.id, input.cashAccountId))
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
      })
      .returning()

    const delta = input.type === 'deposit' ? input.amount : -input.amount
    await tx
      .update(cashAccounts)
      .set({ balance: sql`${cashAccounts.balance} + ${delta}` })
      .where(eq(cashAccounts.id, input.cashAccountId))

    return movement
  })
}

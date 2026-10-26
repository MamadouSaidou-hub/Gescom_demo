import { withTenant } from '../tenant'
import { clients } from '../schema'

export async function createClient(tenantId: number, input: { name: string; phone?: string; storeId?: number | null }) {
  return withTenant(tenantId, async (tx) => {
    const [client] = await tx
      .insert(clients)
      .values({ name: input.name, phone: input.phone ?? null, storeId: input.storeId ?? null, tenantId })
      .returning()
    return client
  })
}

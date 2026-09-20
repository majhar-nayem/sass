import { appPrisma, type PrismaTx } from './client.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class InvalidOrgIdError extends Error {
  constructor(value: string) {
    super(`withOrgContext requires a UUID org id, received: ${JSON.stringify(value)}`)
    this.name = 'InvalidOrgIdError'
  }
}

/**
 * The only supported way for app code to reach the database.
 *
 * Opens a transaction, pins `app.org_id` to it with SET LOCAL, and hands you a client.
 * Every RLS policy reads that setting, so work inside the callback can only see and
 * write rows belonging to this org — even where the query itself forgets to say so.
 *
 * SET LOCAL is transaction-scoped, so the setting cannot leak to the next borrower of
 * a pooled connection. That is the whole reason this is a transaction and not a plain
 * `SET`.
 *
 *   const sites = await withOrgContext(orgId, tx => tx.site.findMany())
 */
export async function withOrgContext<T>(
  orgId: string,
  fn: (tx: PrismaTx) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  // Interpolated into SQL below, so it is validated rather than trusted.
  if (!UUID.test(orgId)) throw new InvalidOrgIdError(orgId)

  return appPrisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${orgId}'`)
      return fn(tx as unknown as PrismaTx)
    },
    { timeout: opts.timeoutMs ?? 15_000 },
  )
}

/**
 * Escape hatch for the genuinely org-less paths. Every call site must say why in the
 * `reason` argument, which makes them greppable at review time.
 *
 * 'session' is the subtle one: establishing who is making a request necessarily happens
 * before we know which org they are acting on, so the lookup cannot be org-scoped. It is
 * narrow by construction — a user row by id, nothing else.
 */
export async function withoutOrgContext<T>(
  reason:
    | 'tenant-resolution'
    | 'session'
    | 'webhook'
    | 'cron'
    | 'migration'
    | 'platform-admin',
  fn: (db: PrismaTx) => Promise<T>,
): Promise<T> {
  const { rawPrisma } = await import('./client.js')
  void reason
  return fn(rawPrisma as unknown as PrismaTx)
}

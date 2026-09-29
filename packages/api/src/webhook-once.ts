import { withoutOrgContextTx, type PrismaTx } from '@awning/db'

/**
 * Process a provider event exactly once — including after a failure.
 *
 * Stripe delivers at least once, so duplicates are ordinary traffic. The earlier
 * pattern claimed the event id with one write and processed it with others. That makes
 * a failure permanent: the claim survives, Stripe retries, the retry sees the claim and
 * is told "duplicate", and the event is never applied. For billing that is a lost
 * payment-failed notice; for orders it is a customer who paid for a ham that does not
 * exist in the system.
 *
 * Here the claim and the work share one transaction.
 *
 *  - Success: commits with `processed_at` set. Every later delivery is a duplicate.
 *  - Failure: rolls back, claim included. Stripe's retry claims afresh and runs.
 *  - Concurrent delivery: the second INSERT blocks on the first's uncommitted row until
 *    it commits (duplicate) or rolls back (the second goes ahead). Never both.
 *
 * `ON CONFLICT … WHERE processed_at IS NULL` is what lets a row from an earlier crashed
 * attempt be reclaimed rather than read as done.
 */
export type Once<T> = { duplicate: true } | { duplicate: false; result: T }

export async function processOnce<T>(
  event: { id: string; type: string; payload: unknown },
  provider: 'stripe' | 'stripe-connect',
  handler: (db: PrismaTx) => Promise<T>,
): Promise<Once<T>> {
  return withoutOrgContextTx('webhook', async (db) => {
    const claimed = await db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO webhook_events (id, provider, type, payload, attempts)
      VALUES (${event.id}, ${provider}, ${event.type}, ${JSON.stringify(event.payload)}::jsonb, 1)
      ON CONFLICT (id) DO UPDATE SET attempts = webhook_events.attempts + 1
        WHERE webhook_events.processed_at IS NULL
      RETURNING id`
    if (claimed.length === 0) return { duplicate: true } as const

    const result = await handler(db)
    await db.webhook_events.update({ where: { id: event.id }, data: { processed_at: new Date(), error: null } })
    return { duplicate: false, result } as const
  })
}

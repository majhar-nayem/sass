import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { STRIPE_DASHBOARD_URL } from '@awning/integrations/stripe-connect'
import { adminProcedure, orgProcedure, router, type OrgContext } from '../trpc.js'
import {
  disconnectStripe,
  ensureStoreSettings,
  paymentsFrom,
  startStripeOnboarding,
  syncStripeAccount,
} from '../store.js'

const siteInput = z.object({ siteId: z.string().uuid() })

/**
 * M-03. Every procedure here goes through orgProcedure, so RLS scopes store_settings
 * to the caller's org — a siteId from another tenant simply finds nothing.
 */
async function ownedSite(c: OrgContext, siteId: string) {
  const site = await c.db.sites.findUnique({ where: { id: siteId }, select: { id: true } })
  if (!site) throw new TRPCError({ code: 'NOT_FOUND' })
  return site
}

export const storeRouter = router({
  /** Cheap: what we last recorded, with no call to Stripe. Used to render the page. */
  payments: orgProcedure.input(siteInput).query(async ({ ctx, input }) => {
    const c = ctx as unknown as OrgContext
    await ownedSite(c, input.siteId)
    const settings = await ensureStoreSettings(c.db, input.siteId)
    return { ...paymentsFrom(settings), dashboardUrl: STRIPE_DASHBOARD_URL }
  }),

  /**
   * Asks Stripe what is true right now. Separate from `payments` because it costs an
   * API call, and because it is what the return-from-onboarding page calls — the
   * redirect itself proves nothing.
   */
  syncPayments: orgProcedure.input(siteInput).mutation(async ({ ctx, input }) => {
    const c = ctx as unknown as OrgContext
    await ownedSite(c, input.siteId)
    return syncStripeAccount(c.db, input.siteId)
  }),

  /** Owner or admin: this attaches a bank account to the business. */
  startStripeOnboarding: adminProcedure
    .input(siteInput.extend({ returnPath: z.string().startsWith('/').max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      await ownedSite(c, input.siteId)

      const base = process.env.APP_URL ?? 'http://localhost:3000'
      const path = input.returnPath ?? `/store/${input.siteId}/payments`
      return startStripeOnboarding(c.db, input.siteId, {
        // Stripe sends them here if the link went stale; it must restart the flow
        // rather than show an error nobody can act on.
        refreshUrl: `${base}${path}?stripe=refresh`,
        returnUrl: `${base}${path}?stripe=return`,
      })
    }),

  disconnectStripe: adminProcedure.input(siteInput).mutation(async ({ ctx, input }) => {
    const c = ctx as unknown as OrgContext
    await ownedSite(c, input.siteId)
    await disconnectStripe(c.db, input.siteId)
    return { ok: true }
  }),
})

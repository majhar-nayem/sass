import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createCheckoutSession, createPortalSession, stripeConfigured } from '@awning/integrations/stripe'
import { adminProcedure, orgProcedure, router, type OrgContext } from '../trpc.js'

export const billingRouter = router({
  /** What the editor's header and the billing page both read. */
  status: orgProcedure.query(async ({ ctx }) => {
    const c = ctx as unknown as OrgContext
    const sub = await c.db.subscriptions.findUnique({
      where: { org_id: c.membership.orgId },
      select: {
        status: true,
        plan_code: true,
        trial_ends_at: true,
        current_period_end: true,
        cancel_at_period_end: true,
        price_locked_cents: true,
        plans: { select: { name: true, price_cents_aud: true, ai_actions_month: true, ecommerce: true } },
      },
    })
    if (!sub) throw new TRPCError({ code: 'NOT_FOUND' })

    const trialDaysLeft = sub.trial_ends_at
      ? Math.max(0, Math.ceil((sub.trial_ends_at.getTime() - Date.now()) / 864e5))
      : null

    return {
      status: sub.status,
      planCode: sub.plan_code,
      planName: sub.plans.name,
      // The locked founding rate, when there is one — never the list price.
      priceCents: sub.price_locked_cents ?? sub.plans.price_cents_aud,
      aiActionsMonth: sub.plans.ai_actions_month,
      ecommerce: sub.plans.ecommerce,
      trialDaysLeft,
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canPublish: sub.status === 'active' || sub.status === 'past_due',
    }
  }),

  plans: orgProcedure.query(async ({ ctx }) => {
    const c = ctx as unknown as OrgContext
    return c.db.plans.findMany({ where: { is_public: true }, orderBy: { sort_order: 'asc' } })
  }),

  /**
   * M-02 -- the moment the card is asked for.
   *
   * Reached from the Publish button, never from signup. Letting an owner watch their own
   * business appear on screen for free and asking afterwards is worth more than any
   * pricing change in the plan (docs/06-COMMERCE-BILLING.md §2).
   */
  checkout: adminProcedure
    .input(z.object({ planCode: z.string().max(40).default('founding'), returnPath: z.string().max(200).default('/') }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      if (!stripeConfigured())
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Billing is not set up yet.' })

      const org = await c.db.organizations.findUnique({
        where: { id: c.membership.orgId },
        select: { stripe_customer_id: true, billing_email: true },
      })

      const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
      const { url } = await createCheckoutSession({
        orgId: c.membership.orgId,
        planCode: input.planCode,
        customerId: org?.stripe_customer_id ?? null,
        email: org?.billing_email ?? '',
        successUrl: `${appUrl}${input.returnPath}?paid=1`,
        cancelUrl: `${appUrl}${input.returnPath}`,
      })
      return { url }
    }),

  /** Card changes, invoices and cancellation all live in Stripe's portal, not here. */
  portal: adminProcedure
    .input(z.object({ returnPath: z.string().max(200).default('/') }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const org = await c.db.organizations.findUnique({
        where: { id: c.membership.orgId },
        select: { stripe_customer_id: true },
      })
      if (!org?.stripe_customer_id)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No billing account yet.' })

      const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
      return { url: await createPortalSession(org.stripe_customer_id, `${appUrl}${input.returnPath}`) }
    }),
})

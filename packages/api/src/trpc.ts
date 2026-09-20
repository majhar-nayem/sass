import { initTRPC, TRPCError } from '@trpc/server'
import superjson from 'superjson'
import { membershipFor, type Membership } from '@awning/auth'
import { withOrgContext, type PrismaTx } from '@awning/db'

export interface Context {
  /** Resolved from the session cookie by the route handler. Never from the client. */
  userId: string | null
  isPlatformAdmin: boolean
  /** Only set when the user explicitly switched orgs; still verified against membership. */
  requestedOrgId?: string | undefined
  ip?: string | undefined
  userAgent?: string | undefined
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter: ({ shape }) => shape,
})

export const router = t.router
export const middleware = t.middleware
export const createCallerFactory = t.createCallerFactory

/** Anyone, signed in or not. Marketing lookups and health only. */
export const publicProcedure = t.procedure

const requireUser = middleware(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
  return next({ ctx: { ...ctx, userId: ctx.userId } })
})

/** Signed in, but not yet acting on an organisation (e.g. during signup). */
export const authedProcedure = t.procedure.use(requireUser)

export interface OrgContext extends Context {
  userId: string
  membership: Membership
  /**
   * The ONLY database handle org-scoped code gets. Already inside a transaction with
   * app.org_id pinned, so row-level security applies to every query made through it.
   */
  db: PrismaTx
}

/**
 * F-08 -- the choke point.
 *
 * Every procedure that touches tenant data uses this. It resolves the org from the
 * user's memberships (never from a client-supplied id), then runs the whole procedure
 * inside withOrgContext, so RLS is active for every query the handler makes.
 *
 * Two consequences worth being explicit about:
 *   - A handler that forgets a `where org_id` clause returns nothing rather than
 *     another tenant's data.
 *   - The entire procedure runs in one transaction. A handler that does slow external
 *     work (an AI call, a Stripe round trip) must do it OUTSIDE the transaction and
 *     write after, or it holds a connection open for the duration.
 */
export const orgProcedure = authedProcedure.use(
  middleware(async ({ ctx, next }) => {
    const membership = await membershipFor(ctx.userId!, ctx.requestedOrgId)
    if (!membership)
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You are not a member of this organisation.',
      })

    return withOrgContext(membership.orgId, async (db) =>
      next({ ctx: { ...ctx, userId: ctx.userId!, membership, db } }),
    )
  }),
)

/** Owner or admin: billing, deletion, removing people. */
export const adminProcedure = orgProcedure.use(
  middleware(async ({ ctx, next }) => {
    const c = ctx as unknown as OrgContext
    if (c.membership.role === 'staff')
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only owners and admins can do that.' })
    return next()
  }),
)

/** Platform staff only. Every use is written to audit_log by the caller. */
export const platformProcedure = authedProcedure.use(
  middleware(async ({ ctx, next }) => {
    if (!ctx.isPlatformAdmin) throw new TRPCError({ code: 'NOT_FOUND' })
    return next()
  }),
)

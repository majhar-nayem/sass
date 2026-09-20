import { z } from 'zod'
import { adminProcedure, authedProcedure, orgProcedure, router, type OrgContext } from '../trpc.js'
import { createOrgForUser, membershipFor } from '@awning/auth'

export const orgRouter = router({
  /** Signup: the user has an account but no org yet, so this is authed, not org-scoped. */
  create: authedProcedure
    .input(
      z.object({
        businessName: z.string().min(1).max(80),
        state: z.enum(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']).optional(),
        abn: z.string().regex(/^\d{11}$/).optional(),
        industry: z.string().max(40).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => createOrgForUser({ userId: ctx.userId!, ...input })),

  current: authedProcedure.query(async ({ ctx }) => membershipFor(ctx.userId!)),

  get: orgProcedure.query(async ({ ctx }) => {
    const c = ctx as unknown as OrgContext
    return c.db.organizations.findUnique({ where: { id: c.membership.orgId } })
  }),

  update: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80).optional(),
        abn: z.string().regex(/^\d{11}$/).nullable().optional(),
        billing_email: z.string().email().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      await c.db.organizations.updateMany({ where: { id: c.membership.orgId }, data: input })
      return { ok: true }
    }),

  members: orgProcedure.query(async ({ ctx }) => {
    const c = ctx as unknown as OrgContext
    return c.db.memberships.findMany({ where: { org_id: c.membership.orgId } })
  }),
})

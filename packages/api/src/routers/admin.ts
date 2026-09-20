import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { withoutOrgContext } from '@awning/db'
import { platformProcedure, router } from '../trpc.js'
import { auditTrail, endImpersonation, grantAiCredit, ImpersonationRefused, listOrgs, startImpersonation } from '../admin.js'
import { collectDigest, renderDigest, runCanaries } from '../monitoring.js'

const refuse = (e: unknown): never => {
  if (e instanceof ImpersonationRefused) throw new TRPCError({ code: 'FORBIDDEN', message: e.message })
  throw e
}

/**
 * O-02 -- operator-only. Every procedure here is platformProcedure, which answers
 * NOT_FOUND rather than FORBIDDEN to a tenant: FORBIDDEN confirms the surface exists.
 */
export const adminRouter = router({
  orgs: platformProcedure
    .input(z.object({ search: z.string().max(80).optional() }).default({}))
    .query(async ({ input }) =>
      withoutOrgContext('platform-admin', (db) => listOrgs(db, { search: input.search })),
    ),

  audit: platformProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ input }) =>
      withoutOrgContext('platform-admin', (db) => auditTrail(db, input.orgId)),
    ),

  impersonate: platformProcedure
    .input(z.object({ userId: z.string().uuid(), reason: z.string().min(3).max(200) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await withoutOrgContext('platform-admin', (db) =>
          startImpersonation(db, ctx.userId!, input.userId, {
            reason: input.reason,
            ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
          }),
        )
      } catch (e) {
        return refuse(e)
      }
    }),

  stopImpersonating: platformProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) =>
      withoutOrgContext('platform-admin', async (db) => {
        await endImpersonation(db, input.token)
        return { ok: true }
      }),
    ),

  grantAi: platformProcedure
    .input(z.object({ orgId: z.string().uuid(), actions: z.number().int(), reason: z.string().min(3).max(200) }))
    .mutation(async ({ ctx, input }) =>
      withoutOrgContext('platform-admin', (db) =>
        grantAiCredit(db, ctx.userId!, input.orgId, input.actions, input.reason),
      ),
    ),

  digest: platformProcedure.query(async () =>
    withoutOrgContext('platform-admin', async (db) => {
      const data = await collectDigest(db)
      return { data, ...renderDigest(data) }
    }),
  ),

  canaries: platformProcedure.mutation(async () =>
    withoutOrgContext('platform-admin', (db) => runCanaries(db, process.env.CANARY_BASE_URL)),
  ),
})

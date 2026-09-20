import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { orgProcedure, router, type OrgContext } from '../trpc.js'

/** The inbox. For a tradie this is the feature they are actually paying for. */
export const leadRouter = router({
  list: orgProcedure
    .input(z.object({ siteId: z.string().uuid(), includeSpam: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      return c.db.form_submissions.findMany({
        where: { site_id: input.siteId, ...(input.includeSpam ? {} : { is_spam: false }) },
        orderBy: { created_at: 'desc' },
        take: 200,
      })
    }),

  markRead: orgProcedure
    .input(z.object({ leadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const n = await c.db.form_submissions.updateMany({
        where: { id: input.leadId },
        data: { read_at: new Date() },
      })
      if (n.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { ok: true }
    }),

  archive: orgProcedure
    .input(z.object({ leadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const n = await c.db.form_submissions.updateMany({
        where: { id: input.leadId },
        data: { archived_at: new Date() },
      })
      if (n.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { ok: true }
    }),
})

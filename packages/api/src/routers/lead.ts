import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { orgProcedure, router, type OrgContext } from '../trpc.js'

/** The inbox. For a tradie this is the feature they are actually paying for. */
/** RFC 4180 quoting. A message containing a comma or a newline is the normal case. */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

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

  /**
   * P-09 -- export.
   *
   * Their leads, their data: an owner who leaves must be able to take the list with
   * them, and in practice this is also how a tradie gets the numbers into the CRM or
   * spreadsheet they already use. Excel is the real consumer, so the BOM matters —
   * without it an apostrophe in "Dave's" renders as mojibake.
   */
  exportCsv: orgProcedure
    .input(z.object({ siteId: z.string().uuid(), includeSpam: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const rows = await c.db.form_submissions.findMany({
        where: { site_id: input.siteId, ...(input.includeSpam ? {} : { is_spam: false }) },
        orderBy: { created_at: 'desc' },
        take: 5000,
      })

      const header = ['Received', 'Name', 'Phone', 'Email', 'Message', 'Form', 'Spam']
      const lines = [
        header.join(','),
        ...rows.map((r) =>
          [
            r.created_at.toISOString(),
            r.name,
            r.phone,
            r.email,
            r.message,
            r.form_key,
            r.is_spam ? 'yes' : 'no',
          ]
            .map(csvCell)
            .join(','),
        ),
      ]
      return { filename: `enquiries-${new Date().toISOString().slice(0, 10)}.csv`, csv: '\uFEFF' + lines.join('\r\n') }
    }),

  /** Unread count for the dashboard badge — the number that pulls an owner back in. */
  unreadCount: orgProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      return c.db.form_submissions.count({
        where: { site_id: input.siteId, is_spam: false, read_at: null, archived_at: null },
      })
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

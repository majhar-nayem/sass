import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { buildFromTemplate, type WebsiteSpec } from '@awning/spec'
import { createOrgForUser } from '@awning/auth'
import { withoutOrgContext } from '@awning/db'
import { generateSite } from '@awning/ai'
import { authedProcedure, router } from '../trpc.js'
import { writeVersion } from '../versions.js'

/**
 * P-01 -- onboarding.
 *
 * Seven questions, none of them required except the first two. The brief's instruction
 * not to make this a thirty-question form is the whole design: every extra field is a
 * chance for a busy sole trader to close the tab, and anything we do not ask can be
 * added later by typing a sentence at the site.
 */
export const Answers = z.object({
  businessName: z.string().min(1).max(80),
  description: z.string().min(1).max(1200),
  suburb: z.string().max(60).optional(),
  state: z.enum(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']).optional(),
  industry: z.string().max(40).optional(),
  services: z.array(z.string().max(60)).max(8).optional(),
  style: z.string().max(40).optional(),
  colours: z.string().max(60).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  whatsapp: z.string().max(30).optional(),
  wantsEcommerce: z.boolean().optional(),
})
export type Answers = z.infer<typeof Answers>

/** Partial while the wizard is in progress; only `complete` demands the full shape. */
const PartialAnswers = Answers.partial()

export const onboardingRouter = router({
  /** Resumes where they left off, or starts fresh. */
  draft: authedProcedure.query(async ({ ctx }) => {
    const row = await withoutOrgContext('session', (db) =>
      db.onboarding_drafts.findUnique({ where: { user_id: ctx.userId! } }),
    )
    if (!row) return { answers: {}, step: 0, resumeToken: null, completed: false }
    return {
      answers: row.answers as Record<string, unknown>,
      step: row.step,
      resumeToken: row.resume_token,
      completed: row.completed_at !== null,
    }
  }),

  /**
   * Autosaved on every step. Cheap, and it is what makes the resume link meaningful —
   * saving only at the end would protect nobody, since the drop-offs happen in between.
   */
  saveDraft: authedProcedure
    .input(z.object({ answers: PartialAnswers, step: z.number().int().min(0).max(10) }))
    .mutation(async ({ ctx, input }) => {
      const row = await withoutOrgContext('session', (db) =>
        db.onboarding_drafts.upsert({
          where: { user_id: ctx.userId! },
          create: { user_id: ctx.userId!, answers: input.answers as never, step: input.step },
          update: { answers: input.answers as never, step: input.step, updated_at: new Date() },
          select: { resume_token: true },
        }),
      )
      return { ok: true, resumeToken: row.resume_token }
    }),

  /**
   * Turns the answers into a live draft site.
   *
   * Generation is attempted first and the template is the fallback — not as a
   * degradation nobody planned for, but because a signup that ends in an error page is
   * a lost customer, and a template site is a perfectly good starting point they can
   * then change by typing. See docs/09-GTM-FINANCE.md R5.
   */
  complete: authedProcedure.input(z.object({ answers: Answers })).mutation(async ({ ctx, input }) => {
    const a = input.answers
    const existing = await withoutOrgContext('session', (db) =>
      db.memberships.findFirst({ where: { user_id: ctx.userId! }, select: { org_id: true } }),
    )
    if (existing)
      throw new TRPCError({ code: 'CONFLICT', message: 'You already have a business set up.' })

    const industry = a.industry ?? 'other'
    const { orgId, siteId, subdomain } = await createOrgForUser({
      userId: ctx.userId!,
      businessName: a.businessName,
      state: a.state,
      industry,
    })

    let spec: WebsiteSpec
    let source: 'ai' | 'template' = 'template'
    let note: string | undefined

    try {
      const generated = await generateSite({
        orgId,
        siteId,
        userId: ctx.userId!,
        brief: {
          businessName: a.businessName,
          description: a.description,
          industry,
          suburb: a.suburb,
          state: a.state,
          services: a.services?.join(', '),
          style: a.style,
          colours: a.colours,
          phone: a.phone,
          email: a.email || undefined,
          whatsapp: a.whatsapp,
          wantsEcommerce: a.wantsEcommerce ?? false,
        },
      })
      if (generated.ok) {
        spec = generated.spec
        source = 'ai'
      } else {
        spec = buildFromTemplate(toTemplateBrief(a, industry))
        note = 'We started you off with a layout for your trade — tell the assistant what to change.'
      }
    } catch {
      // No API key, quota exhausted, circuit breaker open, model down. None of those
      // are the customer's problem at the moment they are signing up.
      spec = buildFromTemplate(toTemplateBrief(a, industry))
      note = 'We started you off with a layout for your trade — tell the assistant what to change.'
    }

    await withoutOrgContext('session', async (db) => {
      await db.sites.update({
        where: { id: siteId },
        data: {
          industry,
          business_phone: a.phone ?? null,
          business_email: a.email || null,
          whatsapp_number: a.whatsapp ?? null,
          business_address: a.suburb ? ({ suburb: a.suburb, state: a.state } as never) : undefined,
        },
      })
      await writeVersion(db, {
        siteId,
        spec,
        summary: source === 'ai' ? 'Generated from your answers' : 'Started from a template',
        createdBy: source === 'ai' ? 'ai' : 'template',
        createdByUser: ctx.userId!,
      })
      await db.organizations.update({
        where: { id: orgId },
        data: { onboarding_completed_at: new Date() },
      })
      await db.onboarding_drafts.updateMany({
        where: { user_id: ctx.userId! },
        data: { completed_at: new Date() },
      })
    })

    return { orgId, siteId, subdomain, source, note }
  }),
})

function toTemplateBrief(a: Answers, industry: string) {
  return {
    businessName: a.businessName,
    description: a.description,
    industry,
    suburb: a.suburb,
    state: a.state,
    services: a.services,
    phone: a.phone,
    email: a.email || undefined,
    whatsapp: a.whatsapp,
    colours: a.colours,
    style: a.style,
  }
}

import { WEBSITE_SPEC_JSON_SCHEMA } from '@awning/spec/generated/schema.js'
import { poolForPrompt, selectPool, STOCK_MANIFEST } from '@awning/spec'
import { validateSpec, type SpecError, type ValidationCtx, type WebsiteSpec } from '@awning/spec'
import { runAiAction } from './client.js'
import { buildSystemPrefix, businessInput } from './prompt.js'
import { packFor } from './industries.js'

const schema = (): Record<string, unknown> =>
  WEBSITE_SPEC_JSON_SCHEMA as unknown as Record<string, unknown>

export interface Brief {
  businessName: string
  description: string
  suburb?: string
  state?: string
  services?: string
  industry: string
  style?: string
  colours?: string
  phone?: string
  email?: string
  whatsapp?: string
  hours?: string
  wantsEcommerce?: boolean
}

export interface GenerateOptions {
  orgId: string
  siteId?: string
  userId?: string
  brief: Brief
  verifiedFacts?: ValidationCtx['verifiedFacts']
  /**
   * Overrides the images offered. Left unset, the industry's slice of the stock pool
   * is used — a site with no photographs at all reads as unfinished, and the pool
   * exists precisely so day one does not look like that.
   */
  availableImages?: Array<{ assetId: string; description: string }>
  maxAttempts?: number
}

export type GenerateResult =
  | { ok: true; spec: WebsiteSpec; attempts: number; costCentsAud: number }
  | { ok: false; errors: SpecError[]; attempts: number; costCentsAud: number }

function userTurn(o: GenerateOptions): string {
  const pack = packFor(o.brief.industry)
  const b = o.brief
  return [
    'Create a complete WebsiteSpecification for the business described below.',
    '',
    businessInput({
      'Business name': b.businessName,
      'What they do': b.description,
      Location: [b.suburb, b.state].filter(Boolean).join(', '),
      'Services / products': b.services,
      'Preferred style': b.style,
      'Preferred colours': b.colours,
      Phone: b.phone,
      Email: b.email,
      WhatsApp: b.whatsapp,
      'Trading hours': b.hours,
      'Wants online selling': b.wantsEcommerce ? 'yes' : 'no',
    }),
    '',
    o.verifiedFacts && Object.keys(o.verifiedFacts).length
      ? `<verified_facts>\n${JSON.stringify(o.verifiedFacts, null, 2)}\n</verified_facts>\nOnly these credentials and track-record claims may appear on the site.`
      : '<verified_facts>\nNone. Do not state any credential, licence, certification, years in business, award or review.\n</verified_facts>',
    '',
    (() => {
      const images =
        o.availableImages ??
        poolForPrompt(selectPool(STOCK_MANIFEST, { industry: o.brief.industry }))
      return images.length
        ? `<available_images>\nUse ONLY these ids. Anything else is rejected.\n${images
            .map((i) => `${i.assetId}: ${i.description}`)
            .join('\n')}\n</available_images>`
        : '<available_images>\nNone. Build a site that reads well with no photographs rather than referencing images that do not exist.\n</available_images>'
    })(),
    '',
    `Suggested section order for this trade: ${pack.sectionOrder.join(' -> ')}`,
    `Today's date: ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n')
}

/**
 * A-03 / A-05 -- generation, with the validation gate and a bounded repair loop.
 *
 * The contract the rest of the product relies on: this either returns a spec that has
 * passed every check, or it returns errors and nothing is persisted. An invalid spec
 * never reaches a renderer, a database row, or a customer.
 *
 * On failure the validator's own messages go back to the model. That is deliberate —
 * they are written to be actionable ("Unsupported credential claim (\"certified\"). The
 * owner has not supplied this.") and a model given the specific reason fixes it far more
 * reliably than one told simply to try again.
 */
export async function generateSite(o: GenerateOptions): Promise<GenerateResult> {
  const maxAttempts = o.maxAttempts ?? 3
  const system = buildSystemPrefix(o.brief.industry)
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: userTurn(o) },
  ]

  let spent = 0
  let lastErrors: SpecError[] = []

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await runAiAction({
      orgId: o.orgId,
      siteId: o.siteId,
      userId: o.userId,
      action: 'generate',
      system,
      messages,
      outputSchema: schema(),
      // A retry caused by the model failing OUR validator is not the customer's fault
      // and must not consume their quota.
      countsToQuota: attempt === 1,
    })
    spent += result.costCentsAud

    const text = result.message.content
      .filter((b): b is { type: 'text'; text: string; citations: null } => b.type === 'text')
      .map((b) => b.text)
      .join('')

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      lastErrors = [{ path: '/', stage: 'schema', message: 'Model did not return valid JSON.' }]
      messages.push(
        { role: 'assistant', content: text.slice(0, 2000) },
        { role: 'user', content: 'That was not valid JSON. Return only the specification object.' },
      )
      continue
    }

    const check = validateSpec(parsed, { verifiedFacts: o.verifiedFacts })
    if (check.ok) return { ok: true, spec: check.spec, attempts: attempt, costCentsAud: spent }

    lastErrors = check.errors
    if (attempt === maxAttempts) break

    messages.push(
      { role: 'assistant', content: text.slice(0, 4000) },
      {
        role: 'user',
        content: [
          'That specification did not pass validation. Fix exactly these problems and return the whole corrected specification:',
          '',
          ...check.errors.slice(0, 12).map((e) => `- ${e.path}: ${e.message}`),
          '',
          'Change nothing else.',
        ].join('\n'),
      },
    )
  }

  return { ok: false, errors: lastErrors, attempts: maxAttempts, costCentsAud: spent }
}

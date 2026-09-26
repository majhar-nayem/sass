import { WebsiteSpecification, type WebsiteSpec } from './spec.js'
import { AA_BODY, AA_LARGE, contrastRatio } from './contrast.js'
import { STOCK_MANIFEST } from './stock-manifest.js'
import { unknownStockIds } from './stock.js'

export interface SpecError {
  path: string
  message: string
  stage: 'schema' | 'semantic' | 'acl' | 'a11y'
}

export type ValidationResult =
  | { ok: true; spec: WebsiteSpec }
  | { ok: false; errors: SpecError[] }

/**
 * Australian Consumer Law. The ACCC pursues fabricated reviews and credentials, and
 * penalties reach the greater of A$50m / 3× benefit / 30% of turnover. A match here is
 * only an error when the owner has not supplied the underlying fact.
 */
const BANNED: Array<[RegExp, string]> = [
  [/\b(licen[sc]ed|certified|accredited|insured|bonded)\b/i, 'credential'],
  [/\blic(ence|ense)?\.?\s*(no|#|number)/i, 'credential'],
  [/\bABN[:\s]*\d/i, 'credential'],
  [/\b(since|est\.?|established)\s*(19|20)\d{2}\b/i, 'track-record'],
  [/\b\d+\+?\s*(years?|yrs?)\s*(of\s*)?(experience|in business|serving)\b/i, 'track-record'],
  [/\b(over|more than)\s*[\d,]+\s*(happy\s*)?(customers|clients|jobs|homes)\b/i, 'track-record'],
  [/\b\d(\.\d)?\s*[-/]?\s*star\b/i, 'social-proof'],
  [/\b(award[- ]winning|voted|rated|#1|number one|best in)\b/i, 'social-proof'],
  [/\b(guaranteed|100%|cheapest|lowest price|unbeatable)\b/i, 'absolute'],
]

const PLACEHOLDER = /(lorem ipsum|your business (name )?here|\[insert|xxx+|tbd)/i

export interface PlanLimits {
  maxPages: number
  ecommerce: boolean
}

export interface ValidationCtx {
  /** Facts the owner actually entered. A banned phrase backed by one of these is fine. */
  verifiedFacts?: {
    abn?: string
    licenceNumber?: string
    yearsInBusiness?: number
    certifications?: string[]
  }
  now?: Date
  /** Plan ceilings. A spec that exceeds them would render a site the owner cannot keep. */
  planLimits?: PlanLimits
}

function walkStrings(v: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof v === 'string') out.push([path, v])
  else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${path}/${i}`, out))
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) walkStrings(x, `${path}/${k}`, out)
}

/**
 * The gate. Nothing renders and nothing persists without passing it.
 * A failure is retried with the error text appended; the previous version stands.
 */
export function validateSpec(input: unknown, ctx: ValidationCtx = {}): ValidationResult {
  const parsed = WebsiteSpecification.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        path: '/' + i.path.join('/'),
        message: i.message,
        stage: 'schema' as const,
      })),
    }
  }
  const spec = parsed.data
  const errors: SpecError[] = []
  const strings: Array<[string, string]> = []
  walkStrings(spec, '', strings)

  const facts = ctx.verifiedFacts ?? {}
  const hasCredential = Boolean(facts.licenceNumber || facts.certifications?.length || facts.abn)
  const hasTrackRecord = typeof facts.yearsInBusiness === 'number'

  for (const [path, text] of strings) {
    for (const [re, kind] of BANNED) {
      if (!re.test(text)) continue
      if (kind === 'credential' && hasCredential) continue
      if (kind === 'track-record' && hasTrackRecord) continue
      errors.push({
        path,
        stage: 'acl',
        message: `Unsupported ${kind} claim ("${re.exec(text)?.[0]}"). The owner has not supplied this. Remove it, or ask them for the real detail.`,
      })
    }
    if (PLACEHOLDER.test(text))
      errors.push({ path, stage: 'semantic', message: 'Placeholder text left in the spec.' })
  }

  // Anchors must resolve, or the nav silently goes nowhere.
  const anchors = new Set<string>()
  const paths = new Set<string>()
  for (const p of spec.pages) {
    paths.add(p.path)
    for (const s of p.sections) if (s.anchor) anchors.add(s.anchor)
  }
  for (const item of spec.nav?.items ?? []) {
    if (item.href.startsWith('#') && !anchors.has(item.href.slice(1)))
      errors.push({ path: '/nav', stage: 'semantic', message: `Nav links to #${item.href.slice(1)}, which no section anchors.` })
    if (item.href.startsWith('/') && !paths.has(item.href))
      errors.push({ path: '/nav', stage: 'semantic', message: `Nav links to ${item.href}, which is not a page.` })
  }

  const now = ctx.now ?? new Date()
  const horizon = new Date(now.getTime() + 365 * 864e5)
  for (const p of spec.pages)
    for (const s of p.sections)
      if (s.type === 'countdown') {
        const ends = new Date(s.props.endsAt)
        if (ends <= now)
          errors.push({ path: `/pages/${p.id}/${s.id}`, stage: 'acl', message: 'Countdown ends in the past.' })
        if (ends > horizon)
          errors.push({ path: `/pages/${p.id}/${s.id}`, stage: 'acl', message: 'Countdown more than a year out is not a real deadline.' })
      }

  if (!spec.pages.some((p) => p.path === '/'))
    errors.push({ path: '/pages', stage: 'semantic', message: 'No home page at "/".' })

  // Paths the renderer owns. A tenant page here would be shadowed by our own route and
  // simply never appear, which is a baffling bug to debug from the owner's side.
  const RESERVED_PATHS = ['/preview', '/api', '/_next', '/sitemap.xml', '/robots.txt']
  for (const page of spec.pages)
    if (RESERVED_PATHS.some((r) => page.path === r || page.path.startsWith(`${r}/`)))
      errors.push({
        path: `/pages/${page.id}`,
        stage: 'semantic',
        message: `"${page.path}" is reserved by the platform. Choose a different address.`,
      })

  // --- contrast ----------------------------------------------------------------
  // Checked against the pairings the renderer ACTUALLY uses. An earlier version asked
  // whether autoContrast could find a legible foreground for each brand colour, which
  // can never fail (the worst case across the whole colour space is 4.58:1) and so
  // caught nothing. These pairings genuinely can fail.
  const t = spec.theme
  const surface = t.surface ?? t.secondary
  const pairings: Array<[string, string, string, number, string]> = [
    ['/theme/neutral', t.neutral, surface, AA_BODY, 'body text on the page surface'],
    ['/theme/neutral', t.neutral, '#ffffff', AA_BODY, 'body text on a white section'],
    ['/theme/primary', t.primary, surface, AA_LARGE, 'headings on the page surface'],
  ]
  for (const [path, fg, bg, target, what] of pairings) {
    const ratio = contrastRatio(fg, bg)
    if (ratio < target)
      errors.push({
        path,
        stage: 'a11y',
        message: `${fg} on ${bg} is ${ratio.toFixed(2)}:1 for ${what}, below the ${target}:1 minimum. Darken it.`,
      })
  }
  // A brand whose primary and accent are nearly the same reads as a mistake.
  if (contrastRatio(t.primary, t.accent) < 1.4)
    errors.push({
      path: '/theme/accent',
      stage: 'a11y',
      message: 'The accent is almost identical to the primary colour, so buttons will not stand out.',
    })

  // --- stock references ------------------------------------------------------
  // A model can invent a plausible id, and the renderer would silently drop the image —
  // which reads as a broken layout rather than as an error anyone can trace.
  for (const bad of unknownStockIds(spec, STOCK_MANIFEST))
    errors.push({
      path: '/pages',
      stage: 'semantic',
      message: `"${bad}" is not an image in the library. Use one of the ids you were given, or leave the image out.`,
    })

  // --- plan limits -------------------------------------------------------------
  if (ctx.planLimits && spec.pages.length > ctx.planLimits.maxPages)
    errors.push({
      path: '/pages',
      stage: 'semantic',
      message: `This plan allows ${ctx.planLimits.maxPages} pages; the specification has ${spec.pages.length}.`,
    })

  return errors.length ? { ok: false, errors } : { ok: true, spec }
}

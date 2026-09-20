import { AA_BODY, contrastRatio, validateSpec, type WebsiteSpec } from '@awning/spec'
import type { EvalBrief } from './briefs.js'

/**
 * What a generated site has to be true of, beyond "the schema accepted it".
 *
 * These are the checks that stop a prompt change from quietly degrading every new
 * customer's site. They run against a spec object, so they work identically on a live
 * generation and on a stored fixture — which is what makes the harness runnable in CI
 * without an API key.
 */
export interface Finding {
  rule: string
  detail: string
}

const AMERICANISMS: Array<[RegExp, string]> = [
  [/\bcolor(s|ed|ing)?\b/i, 'color -> colour'],
  [/\bcenter(s|ed|ing)?\b/i, 'center -> centre'],
  [/\borganiz(e|ed|ing|ation)\b/i, 'organize -> organise'],
  [/\bspecializ(e|ed|ing)\b/i, 'specialize -> specialise'],
  [/\bcell ?phone\b/i, 'cellphone -> mobile'],
  [/\bzip code\b/i, 'zip code -> postcode'],
  [/\bsales tax\b/i, 'sales tax -> GST'],
  [/\bfall\b(?!\s*(back|over|off))/i, 'fall -> autumn'],
  [/\bsidewalk\b/i, 'sidewalk -> footpath'],
  [/\bgas station\b/i, 'gas station -> service station'],
]

const PLACEHOLDERS = /(lorem ipsum|your business (name )?here|\[insert|\bTBD\b|xxx+)/i

const NORTHERN_CHRISTMAS = /\b(snow|snowy|snowfall|mulled wine|sleigh|frost|chestnuts roasting|cosy winter|white christmas)\b/i

function strings(v: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof v === 'string') out.push([path, v])
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}/${i}`, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, `${path}/${k}`, out)
}

export function assertSpec(spec: WebsiteSpec, brief: EvalBrief): Finding[] {
  const findings: Finding[] = []
  const add = (rule: string, detail: string) => findings.push({ rule, detail })

  // 1. Still valid under the full gate, including the ACL and contrast stages.
  const check = validateSpec(spec, {})
  if (!check.ok)
    for (const e of check.errors.slice(0, 5)) add('schema', `${e.path}: ${e.message}`)

  const text: Array<[string, string]> = []
  strings(spec, '', text)

  // 2. Required sections for the trade.
  const types = new Set(spec.pages.flatMap((p) => p.sections.map((s) => s.type)))
  for (const r of brief.requires ?? [])
    if (!types.has(r as never)) add('required-section', `missing "${r}"`)

  // 3. Forbidden content — this is where the ACL cases land.
  for (const f of brief.forbids ?? [])
    for (const [path, s] of text)
      if (s.toLowerCase().includes(f.toLowerCase())) add('forbidden', `"${f}" at ${path}`)

  // 4. No placeholders.
  for (const [path, s] of text) if (PLACEHOLDERS.test(s)) add('placeholder', `${path}: ${s.slice(0, 60)}`)

  // 5. Australian English.
  for (const [path, s] of text)
    for (const [re, fix] of AMERICANISMS)
      if (re.test(s)) add('en-AU', `${fix} at ${path}`)

  // 6. Northern-hemisphere Christmas. Australia's is summer, and a model that has read
  //    a million Christmas pages will reach for snow unless stopped.
  for (const [path, s] of text)
    if (NORTHERN_CHRISTMAS.test(s)) add('southern-christmas', `${path}: ${s.slice(0, 60)}`)

  // 7. Palette is legible in the pairings the renderer uses.
  const surface = spec.theme.surface ?? spec.theme.secondary
  for (const [name, fg, bg] of [
    ['neutral-on-surface', spec.theme.neutral, surface],
    ['neutral-on-white', spec.theme.neutral, '#ffffff'],
  ] as const) {
    const r = contrastRatio(fg, bg)
    if (r < AA_BODY) add('contrast', `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1`)
  }

  // 8. Every image has real alt text.
  for (const [path, s] of text)
    if (path.endsWith('/alt') && s.trim().length < 5) add('alt-text', `${path} is too short`)

  // 9. One h1 per page: exactly one hero.
  for (const p of spec.pages) {
    const heroes = p.sections.filter((s) => s.type === 'hero').length
    if (heroes > 1) add('headings', `page ${p.id} has ${heroes} heroes`)
  }

  // 10. Reachable phone. For a trade this is the entire point of the website.
  const tradeIndustries = ['plumber', 'electrician', 'builder', 'cleaner', 'mechanic', 'landscaper', 'removalist']
  if (tradeIndustries.includes(spec.site.industry) && brief.brief.phone) {
    const hasTel = text.some(([, s]) => s.startsWith('tel:'))
    if (!hasTel) add('phone-cta', 'a trade site with a phone number has no tel: link')
  }

  // 11. SEO metadata on every page.
  for (const p of spec.pages) {
    if (!p.seo?.title) add('seo', `page ${p.id} has no SEO title`)
    if (!p.seo?.description) add('seo', `page ${p.id} has no meta description`)
  }

  // 12. Not padded. A twelve-section page for a one-line brief is a tell.
  const home = spec.pages.find((p) => p.path === '/')
  if (home && home.sections.length > 10) add('padding', `home page has ${home.sections.length} sections`)

  return findings
}

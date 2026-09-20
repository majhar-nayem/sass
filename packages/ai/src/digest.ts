import type { SectionSpec, WebsiteSpec } from '@awning/spec'

/**
 * A-09 -- the spec digest.
 *
 * Sending the whole specification on every edit turn costs ~9k input tokens for a site
 * of any size, most of it copy the model does not need in order to decide which section
 * to change. The digest is the shape of the document plus enough text to identify each
 * part — around 1.2k tokens — and the full props of whichever sections look relevant.
 *
 * When the digest is not enough the model calls ask_user or edits the wrong thing and we
 * see it in the thumbs-down rate. That is a cheaper failure than paying to resend the
 * entire document on every turn forever.
 */

const PREVIEW = 60

function firstText(props: unknown, depth = 0): string | null {
  if (typeof props === 'string') return props
  if (depth > 2 || !props || typeof props !== 'object') return null
  for (const v of Object.values(props as Record<string, unknown>)) {
    const t = firstText(v, depth + 1)
    if (t && t.length > 3) return t
  }
  return null
}

function summarise(section: SectionSpec): string {
  const props = section.props as Record<string, unknown>
  const label = (props.heading as string) ?? firstText(props) ?? ''
  const short = label.length > PREVIEW ? `${label.slice(0, PREVIEW)}…` : label
  const bits = [`${section.id} (${section.type}/${section.variant})`]
  if (short) bits.push(`"${short}"`)
  if (section.hidden) bits.push('[hidden]')
  if (section.anchor) bits.push(`#${section.anchor}`)
  if (section.background && section.background !== 'default') bits.push(`bg:${section.background}`)
  return bits.join(' ')
}

export function buildDigest(spec: WebsiteSpec): string {
  const lines: string[] = [
    `site: ${spec.site.businessName} (${spec.site.industry}, ${spec.site.style})`,
    `theme: primary ${spec.theme.primary}, accent ${spec.theme.accent}, secondary ${spec.theme.secondary}, neutral ${spec.theme.neutral}`,
    `fonts: ${spec.theme.headingFont} / ${spec.theme.bodyFont}; radius ${spec.theme.radius}, density ${spec.theme.density}, shadow ${spec.theme.shadow}`,
  ]

  if (spec.nav?.items?.length)
    lines.push(`nav: ${spec.nav.items.map((i) => `${i.label}->${i.href}`).join(', ')}`)

  const globals = Object.entries(spec.globals ?? {}).filter(([, v]) => v)
  if (globals.length) lines.push(`globals: ${globals.map(([k]) => k).join(', ')}`)

  for (const page of spec.pages) {
    lines.push('', `page ${page.id} at ${page.path} — "${page.title}"`)
    page.sections.forEach((s, i) => lines.push(`  ${i}. ${summarise(s)}`))
  }
  return lines.join('\n')
}

/**
 * Picks the sections whose full props are worth sending, by overlap between the owner's
 * words and the section's type, id and visible text.
 *
 * Deliberately generous — three sections of full props is a few hundred tokens, and
 * sending one section too many is far cheaper than a wrong edit.
 */
export function relevantSections(spec: WebsiteSpec, message: string, limit = 3): SectionSpec[] {
  const words = new Set(
    message
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  )

  const SYNONYMS: Record<string, string[]> = {
    hero: ['banner', 'top', 'header', 'headline', 'masthead', 'first'],
    services: ['service', 'what', 'offer', 'jobs', 'work', 'prices', 'pricing'],
    testimonials: ['review', 'reviews', 'testimonial', 'feedback', 'customers'],
    contactForm: ['form', 'enquiry', 'enquiries', 'quote', 'contact'],
    contact: ['contact', 'phone', 'address', 'hours', 'email'],
    imageText: ['about', 'story', 'us'],
    countdown: ['countdown', 'timer', 'deadline', 'closing'],
    cta: ['cta', 'button', 'call to action'],
  }

  const scored = spec.pages.flatMap((p) =>
    p.sections.map((s) => {
      let score = 0
      if (words.has(s.type.toLowerCase())) score += 5
      for (const syn of SYNONYMS[s.type] ?? []) if (words.has(syn)) score += 4
      for (const part of s.id.split('-')) if (words.has(part)) score += 3
      const text = JSON.stringify(s.props).toLowerCase()
      for (const w of words) if (w.length > 4 && text.includes(w)) score += 1
      return { section: s, score }
    }),
  )

  const hits = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  // Nothing matched: send the first section of the home page so the model has at least
  // one concrete example of the props shape rather than guessing it.
  if (hits.length === 0) {
    const first = spec.pages.find((p) => p.path === '/')?.sections[0]
    return first ? [first] : []
  }
  return hits.slice(0, limit).map((x) => x.section)
}

export function buildEditContext(spec: WebsiteSpec, message: string): string {
  const relevant = relevantSections(spec, message)
  return [
    '<current_site>',
    buildDigest(spec),
    '</current_site>',
    '',
    '<relevant_sections>',
    JSON.stringify(relevant, null, 2),
    '</relevant_sections>',
  ].join('\n')
}

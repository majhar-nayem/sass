import { describe, expect, it } from 'vitest'
import { buildFromTemplate, type TemplateBrief } from '../templates.js'
import { validateSpec } from '../validate.js'
import { contrastRatio, autoContrast, AA_BODY } from '../contrast.js'

/**
 * Templates are the floor on quality and the fallback when the model is unavailable, so
 * they have to hold up on their own — not merely "not crash".
 */
const brief = (over: Partial<TemplateBrief> = {}): TemplateBrief => ({
  businessName: "Dave's Gas & Plumbing",
  description: 'Two vans doing blocked drains and hot water across the northern suburbs.',
  industry: 'plumber',
  suburb: 'Salisbury',
  state: 'SA',
  services: ['Blocked drains', 'Hot water', 'Burst pipes', 'Gas fitting'],
  phone: '08 8123 4567',
  ...over,
})

describe('buildFromTemplate', () => {
  it('produces a spec that passes the full validation gate', () => {
    expect(validateSpec(buildFromTemplate(brief())).ok).toBe(true)
  })

  it.each([
    'plumber', 'electrician', 'builder', 'cleaner', 'mechanic', 'landscaper',
    'barber', 'hair-salon', 'beauty', 'cafe', 'restaurant', 'bakery',
    'butcher', 'grocer', 'florist', 'gift-shop', 'accountant', 'other',
  ])('produces a valid spec for %s', (industry) => {
    const r = validateSpec(buildFromTemplate(brief({ industry })))
    expect(r.ok, r.ok ? '' : r.errors.map((e) => `${e.path} ${e.message}`).join('; ')).toBe(true)
  })

  /** The minimum the wizard can hand over: two required answers and nothing else. */
  it('works from only a name and a description', () => {
    const spec = buildFromTemplate({
      businessName: 'A Business',
      description: 'We do a thing.',
      industry: 'other',
    })
    expect(validateSpec(spec).ok).toBe(true)
    expect(spec.pages[0]!.sections.length).toBeGreaterThanOrEqual(3)
  })

  /**
   * An empty section reads as unfinished, which is the exact impression this product
   * exists to avoid. Sections appear only when there is something real to put in them.
   */
  it('omits the services section rather than showing an empty one', () => {
    const types = buildFromTemplate(brief({ services: [] })).pages[0]!.sections.map((s) => s.type)
    expect(types).not.toContain('services')
  })

  it('omits contact details when there are none', () => {
    const types = buildFromTemplate(
      brief({ phone: undefined, email: undefined }),
    ).pages[0]!.sections.map((s) => s.type)
    expect(types).not.toContain('contact')
  })

  it('always leaves a way to get in touch', () => {
    const types = buildFromTemplate(brief({ phone: undefined, email: undefined })).pages[0]!.sections.map((s) => s.type)
    expect(types).toContain('contactForm')
  })

  it('makes the phone reachable in one tap for a trade', () => {
    const spec = buildFromTemplate(brief())
    expect(JSON.stringify(spec)).toContain('tel:0881234567')
    expect(spec.globals?.stickyCallBar?.enabled).toBe(true)
  })

  it('reads plain-language colour requests', () => {
    expect(buildFromTemplate(brief({ colours: 'dark green and gold' })).theme.primary).toBe('#173B2A')
    expect(buildFromTemplate(brief({ colours: 'navy' })).theme.primary).toBe('#12324A')
    expect(buildFromTemplate(brief({ colours: 'burgundy' })).theme.primary).toBe('#5A1F25')
  })

  it('falls back to the trade’s own palette when no colour is given', () => {
    expect(buildFromTemplate(brief({ industry: 'butcher', colours: undefined })).theme.primary).toBe('#173B2A')
  })

  /** Every palette a template can emit has to be legible, for every industry. */
  it('never produces an illegible palette', () => {
    for (const industry of ['plumber', 'butcher', 'cafe', 'barber', 'electrician', 'other'])
      for (const colours of [undefined, 'dark green and gold', 'navy', 'black', 'teal', 'terracotta']) {
        const t = buildFromTemplate(brief({ industry, colours })).theme
        for (const c of [t.primary, t.accent, t.neutral])
          expect(contrastRatio(c, autoContrast(c)), `${industry}/${colours}: ${c}`).toBeGreaterThanOrEqual(AA_BODY)
      }
  })

  it('fills in SEO metadata', () => {
    const page = buildFromTemplate(brief()).pages[0]!
    expect(page.seo?.title).toContain("Dave's")
    expect(page.seo?.description?.length).toBeGreaterThan(20)
  })

  it('every nav link points at a section that exists', () => {
    const spec = buildFromTemplate(brief())
    const anchors = new Set(spec.pages.flatMap((p) => p.sections.map((s) => s.anchor).filter(Boolean)))
    for (const item of spec.nav?.items ?? [])
      if (item.href.startsWith('#')) expect(anchors).toContain(item.href.slice(1))
  })

  it('turns on the WhatsApp bubble only when there is a number', () => {
    expect(buildFromTemplate(brief()).globals?.whatsappBubble).toBeUndefined()
    expect(buildFromTemplate(brief({ whatsapp: '0412 345 678' })).globals?.whatsappBubble?.enabled).toBe(true)
  })

  it('survives awkward input the wizard will genuinely produce', () => {
    for (const b of [
      brief({ businessName: 'Café Küche' }),
      brief({ businessName: 'A'.repeat(80) }),
      // A long but genuine description. 'x'.repeat(1200) would trip the placeholder
      // detector, correctly — that is not input a real owner produces.
      brief({ description: 'We have been doing blocked drains and hot water across the northern suburbs for a while now. '.repeat(12) }),
      brief({ services: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'] }),
      brief({ suburb: undefined, state: undefined }),
    ])
      expect(validateSpec(buildFromTemplate(b)).ok).toBe(true)
  })
})

describe('reserved page paths', () => {
  it('rejects a page that would be shadowed by a platform route', () => {
    const spec = buildFromTemplate(brief()) as unknown as {
      pages: Array<{ id: string; path: string; title: string; sections: unknown[] }>
    }
    spec.pages.push({ ...spec.pages[0]!, id: 'preview', path: '/preview' })
    const r = validateSpec(spec)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.message.includes('reserved'))).toBe(true)
  })
})

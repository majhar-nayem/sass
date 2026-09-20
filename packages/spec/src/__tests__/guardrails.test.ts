import { describe, expect, it } from 'vitest'
import { validateSpec } from '../validate.js'
import { Section } from '../spec.js'
import { COMPONENTS } from '../components/index.js'
import type { WebsiteSpec } from '../spec.js'
import { STOCK_MANIFEST } from '../stock-manifest.js'

/**
 * The guardrail suite. These are not style checks — most of them encode an obligation
 * under the Australian Consumer Law or WCAG. See docs/00-PRD.md §7.
 *
 * Run against validateSpec, the same gate production uses, not a parallel copy.
 */
const base = (): WebsiteSpec =>
  JSON.parse(
    JSON.stringify({
      specVersion: 1,
      site: {
        businessName: 'Adelaide Halal Meats',
        industry: 'butcher',
        style: 'premium-modern',
        tone: 'warm',
        locale: 'en-AU',
        currency: 'AUD',
        showAbnInFooter: true,
      },
      theme: {
        primary: '#173B2A', secondary: '#F5EEDC', accent: '#C9A227', neutral: '#1A1A1A',
        headingFont: 'Playfair Display', bodyFont: 'Inter',
        radius: 'md', density: 'comfortable', shadow: 'soft', buttonStyle: 'solid', darkMode: false,
      },
      pages: [
        {
          id: 'home', path: '/', title: 'Adelaide Halal Meats',
          sections: [
            {
              id: 'hero-main', type: 'hero', variant: 'split',
              hidden: false, background: 'default', spacing: 'lg',
              props: {
                heading: 'Fresh halal meat, cut the way you like it',
                subheading: 'Family-run butcher in Mile End. Free delivery across metro Adelaide over $80.',
                primaryCta: { label: "See this week's specials", href: '#specials', style: 'primary', icon: 'arrow' },
                trustPoints: ['Delivery Tue & Fri', 'Open 7 days', 'Cut to order'],
                height: 'medium', align: 'left',
              },
            },
            {
              id: 'services-grid', type: 'services', variant: 'cards',
              hidden: false, background: 'default', spacing: 'lg',
              props: {
                heading: 'What we do', columns: 3,
                items: [
                  { title: 'Fresh lamb & goat', description: 'Whole, half or cut to order.', icon: 'beef' },
                  { title: 'Weekly specials', description: 'New prices every Monday.', icon: 'star' },
                ],
              },
            },
          ],
        },
      ],
    }),
  )

type Mut = (d: any) => void
const check = (mut?: Mut, ctx = {}) => {
  const d = base() as any
  mut?.(d)
  return validateSpec(d, ctx)
}
const reasons = (r: ReturnType<typeof validateSpec>) =>
  r.ok ? [] : r.errors.map((e) => `${e.stage}:${e.message}`)

const push = (d: any, s: object) => d.pages[0].sections.push({
  hidden: false, background: 'default', spacing: 'lg', ...s,
})

describe('registry parity', () => {
  /**
   * A component added to the catalogue but left out of the Section union would be
   * described to the model and then rejected on every use — a confusing, expensive
   * failure. Assert the two lists cannot drift.
   */
  it('every catalogued component is a member of the Section union', () => {
    const inUnion = [...Section.options].map((o) => o.shape.type.value).sort()
    const inCatalogue = COMPONENTS.map((c) => c.type).sort()
    expect(inUnion).toEqual(inCatalogue)
  })
})

describe('schema: only approved components exist', () => {
  it('accepts a valid spec', () => expect(check().ok).toBe(true))

  it('rejects an invented component type', () => {
    const r = check((d) => push(d, { id: 'px1', type: 'parallaxHero', variant: 'cool', props: {} }))
    expect(r.ok).toBe(false)
  })

  it('rejects a real component with an invented variant', () => {
    const r = check((d) => push(d, { id: 'hx1', type: 'hero', variant: 'ultra', props: { heading: 'Hi there' } }))
    expect(r.ok).toBe(false)
  })

  it('rejects a smuggled customHtml prop instead of silently stripping it', () => {
    const r = check((d) => { d.pages[0].sections[0].props.customHtml = '<script>fetch("//evil")</script>' })
    expect(r.ok).toBe(false)
    expect(reasons(r).join()).toMatch(/unrecognized key/i)
  })

  it('rejects a javascript: URL', () => {
    const r = check((d) => { d.pages[0].sections[0].props.primaryCta.href = 'javascript:alert(1)' })
    expect(r.ok).toBe(false)
  })

  it('rejects a font outside the closed set', () => {
    expect(check((d) => { d.theme.headingFont = 'Comic Sans MS' }).ok).toBe(false)
  })

  it('rejects a non-hex colour', () => {
    expect(check((d) => { d.theme.primary = 'dark green' }).ok).toBe(false)
  })

  it('rejects a hero heading that would blow the layout', () => {
    expect(check((d) => { d.pages[0].sections[0].props.heading = 'x'.repeat(180) }).ok).toBe(false)
  })
})

describe('ACL: the model cannot fabricate social proof', () => {
  const testimonial = (extra: object) => (d: any) =>
    push(d, { id: 'tst-1', type: 'testimonials', variant: 'cards',
      props: { items: [{ quote: 'Best meat in Adelaide, always fresh.', author: 'Sarah M.', ...extra }] } })

  it('rejects an invented testimonial with no source', () => {
    expect(check(testimonial({})).ok).toBe(false)
  })

  it('rejects a testimonial the model labels as its own', () => {
    expect(check(testimonial({ source: 'ai_generated' })).ok).toBe(false)
  })

  it('accepts a genuine customer-supplied testimonial', () => {
    expect(check(testimonial({ source: 'customer_supplied', location: 'Torrensville', rating: 5 })).ok).toBe(true)
  })

  it('rejects an unbacked credential claim', () => {
    const r = check((d) => { d.pages[0].sections[1].props.items[0].description = 'Fully licensed and insured.' })
    expect(r.ok).toBe(false)
    expect(reasons(r).join()).toMatch(/acl:.*credential/i)
  })

  it('accepts the same claim when the owner supplied the licence', () => {
    const r = check(
      (d) => { d.pages[0].sections[1].props.items[0].description = 'Fully licensed and insured.' },
      { verifiedFacts: { licenceNumber: 'PGE 123456' } },
    )
    expect(r.ok).toBe(true)
  })

  it('rejects an invented track record', () => {
    const r = check((d) => { d.pages[0].sections[0].props.subheading = 'Serving Adelaide since 1987.' })
    expect(reasons(r).join()).toMatch(/acl:.*track-record/i)
  })

  /**
   * The halal certification case is worth its own test: it is a real, checkable
   * credential and the most important trust signal a halal butcher has. The rule is not
   * "never say certified" — it is "never say it unless the owner told us". Which means
   * onboarding needs a certifications field, and this is what proves it matters.
   */
  it('rejects an unbacked halal certification claim', () => {
    const r = check((d) => { d.pages[0].sections[0].props.trustPoints = ['Halal certified by ICCV'] })
    expect(r.ok).toBe(false)
    expect(reasons(r).join()).toMatch(/acl:.*credential/i)
  })

  it('accepts it once the owner has entered the certification', () => {
    const r = check(
      (d) => { d.pages[0].sections[0].props.trustPoints = ['Halal certified by ICCV'] },
      { verifiedFacts: { certifications: ['Halal certified by ICCV'] } },
    )
    expect(r.ok).toBe(true)
  })

  it('rejects "cheapest in Adelaide"', () => {
    const r = check((d) => { d.pages[0].sections[0].props.subheading = 'The cheapest halal meat in Adelaide.' })
    expect(reasons(r).join()).toMatch(/acl:/)
  })
})

describe('ACL: countdowns must reference a real deadline', () => {
  const cd = (props: object) => (d: any) =>
    push(d, { id: 'cd-1', type: 'countdown', variant: 'bar', props })

  it('rejects an evergreen countdown with no end date', () => {
    expect(check(cd({ heading: 'Hurry, ends soon!' })).ok).toBe(false)
  })

  it('rejects a countdown that already expired', () => {
    expect(check(cd({ heading: 'Orders close', endsAt: '2020-12-20T17:00:00+10:30' })).ok).toBe(false)
  })

  it('rejects a countdown more than a year out', () => {
    expect(check(cd({ heading: 'Orders close', endsAt: '2099-12-20T17:00:00+10:30' })).ok).toBe(false)
  })

  it('accepts a real deadline', () => {
    const soon = new Date(Date.now() + 30 * 864e5).toISOString()
    expect(check(cd({ heading: 'Christmas orders close', endsAt: soon })).ok).toBe(true)
  })
})

describe('image references', () => {
  // The model is given a list of ids. Inventing one outside that list used to produce a
  // site that renders with a hole in it, which looks like our bug, not the model's.
  it('rejects a stock id that is not in the library', () => {
    const r = check((d) => {
      d.pages[0].sections[0].props.image = { assetId: 'stock:butcher-hero-sunset', alt: 'A butcher at work' }
    })
    expect(r.ok).toBe(false)
    expect(reasons(r).join()).toMatch(/not an image in the library/)
  })

  it('accepts an id that is in the library', () => {
    const real = STOCK_MANIFEST.entries[0]!.id
    const r = check((d) => {
      d.pages[0].sections[0].props.image = { assetId: `stock:${real}`, alt: 'Background texture' }
    })
    expect(r.ok).toBe(true)
  })
})

describe('accessibility and coherence', () => {
  it('rejects a content image with no alt text', () => {
    expect(check((d) => { d.pages[0].sections[0].props.image = { assetId: 'asset_ab12cd34' } }).ok).toBe(false)
  })

  it('rejects leftover placeholder copy', () => {
    const r = check((d) => { d.pages[0].sections[0].props.heading = 'Your Business Name Here' })
    expect(reasons(r).join()).toMatch(/placeholder/i)
  })

  it('rejects a nav link to an anchor no section defines', () => {
    const r = check((d) => { d.nav = { variant: 'simple', showPhone: true, items: [{ label: 'Specials', href: '#specials' }] } })
    expect(reasons(r).join()).toMatch(/anchors/)
  })

  it('accepts the nav link once a section carries that anchor', () => {
    const r = check((d) => {
      d.pages[0].sections[1].anchor = 'specials'
      d.nav = { variant: 'simple', showPhone: true, items: [{ label: 'Specials', href: '#specials' }] }
    })
    expect(r.ok).toBe(true)
  })

  it('rejects a spec with no home page', () => {
    expect(check((d) => { d.pages[0].path = '/about' }).ok).toBe(false)
  })
})

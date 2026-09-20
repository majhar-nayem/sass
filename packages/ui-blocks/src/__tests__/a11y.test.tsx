import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import axe from 'axe-core'
import { COMPONENTS, type BusinessFacts, type SectionSpec } from '@awning/spec'
import { renderSection } from '../sections.js'
import { SpecRenderer } from '../renderer.js'
import { autoContrast, contrastRatio } from '../theme.js'

/**
 * C-05 -- the accessibility gate.
 *
 * WCAG 2.1 AA is cheap to build in and brutal to retrofit, and it is what protects
 * tenants from a Disability Discrimination Act complaint they would blame us for. This
 * runs every component against every one of its variants, so adding a variant without
 * thinking about semantics fails here rather than on a customer's live site.
 */

const business: BusinessFacts = {
  businessName: "Dave's Gas & Plumbing",
  phone: '08 8123 4567',
  email: 'dave@example.test',
  whatsapp: '0412 345 678',
  abn: '51824753556',
  address: { line1: '12 Main North Rd', suburb: 'Salisbury', state: 'SA', postcode: '5108' },
  serviceAreas: ['Salisbury', 'Elizabeth'],
  socials: { facebook: 'https://facebook.com/example' },
  openingHours: {
    monday: { open: '6:00am', close: '8:00pm' },
    sunday: null,
  },
}

const image = { assetId: 'asset_ab12cd34', alt: 'Dave outside his van in Salisbury', focal: 'center' as const }
const cta = { label: 'Call 08 8123 4567', href: 'tel:0881234567', style: 'primary' as const, icon: 'phone' as const }

/** Realistic props per component type — a fixture that renders nothing proves nothing. */
const PROPS: Record<string, unknown> = {
  hero: {
    eyebrow: 'Salisbury & northern suburbs',
    heading: 'Blocked drains cleared today',
    subheading: 'Two vans on the road across northern Adelaide.',
    image,
    primaryCta: cta,
    secondaryCta: { label: 'Get a quote', href: '#contact', style: 'ghost', icon: 'none' },
    trustPoints: ['On the road 6am–8pm', 'Upfront pricing'],
    height: 'medium',
    align: 'left',
  },
  services: {
    heading: 'What we do',
    columns: 3,
    items: [
      { title: 'Blocked drains', description: 'Camera inspection and jet rodding.', priceFrom: 'From $180' },
      { title: 'Hot water', description: 'Repairs and replacements.' },
      { title: 'Gas fitting', description: 'Cooktops, heaters and gas lines.' },
    ],
  },
  imageText: {
    heading: 'Dave, two vans and an apprentice',
    body: 'First paragraph about the business.\n\nSecond paragraph with more detail.',
    image,
    cta: { label: 'Get a quote', href: '#contact', style: 'ghost', icon: 'none' },
  },
  testimonials: {
    heading: 'What customers say',
    items: [
      {
        quote: 'Came out the same afternoon and cleared the drain in an hour.',
        author: 'Marie T.',
        location: 'Para Hills',
        rating: 5,
        source: 'customer_supplied',
      },
    ],
  },
  countdown: {
    heading: 'Bookings close before the Christmas shutdown',
    endsAt: new Date(Date.now() + 30 * 864e5).toISOString(),
    expiredMessage: 'Back on the tools from 12 January.',
    cta,
  },
  contact: {
    heading: 'Get in touch',
    showPhone: true,
    showEmail: true,
    showAddress: true,
    showHours: true,
    showServiceAreas: true,
    showMap: false,
    note: 'After hours? Leave a message.',
  },
  contactForm: {
    heading: 'Ask for a quote',
    subheading: 'Tell us what is going on.',
    submitLabel: 'Send enquiry',
    fields: [
      { key: 'name', label: 'Your name', type: 'text', required: true },
      { key: 'phone', label: 'Phone', type: 'tel', required: true },
      { key: 'job_type', label: 'What do you need?', type: 'select', required: true, options: ['Blocked drain', 'Hot water'] },
      { key: 'message', label: 'Any details', type: 'textarea', required: false },
      { key: 'consent', label: 'Send me occasional updates', type: 'checkbox', required: false },
    ],
  },
  cta: {
    heading: 'Need a plumber today?',
    subheading: 'Call Dave direct.',
    primaryCta: cta,
    secondaryCta: { label: 'Send an enquiry', href: '#contact', style: 'ghost', icon: 'none' },
  },
}

async function violationsOf(html: string, label: string) {
  document.body.innerHTML = `<div id="root">${html}</div>`
  const results = await axe.run(document.getElementById('root')!, {
    // Rules that need a whole document rather than a fragment; the full-page test below
    // covers landmarks, and colour contrast is asserted separately against the tokens
    // because jsdom does not compute CSS.
    rules: {
      region: { enabled: false },
      'page-has-heading-one': { enabled: false },
      'landmark-one-main': { enabled: false },
      'color-contrast': { enabled: false },
    },
  })
  return results.violations.map(
    (v) => `${label}: ${v.id} — ${v.help} (${v.nodes.length} node${v.nodes.length > 1 ? 's' : ''})`,
  )
}

describe('every component, every variant', () => {
  const cases = COMPONENTS.flatMap((c) =>
    c.variants.map((variant) => ({ type: c.type, variant })),
  )

  it(`covers all ${COMPONENTS.length} components`, () => {
    expect(cases.length).toBeGreaterThanOrEqual(COMPONENTS.length)
    for (const c of COMPONENTS) expect(PROPS[c.type], `no fixture for ${c.type}`).toBeDefined()
  })

  it.each(cases)('$type / $variant has no axe violations', async ({ type, variant }) => {
    const section = {
      id: `${type}-1`,
      type,
      variant,
      hidden: false,
      background: 'default',
      spacing: 'lg',
      props: PROPS[type],
    } as unknown as SectionSpec

    const html = renderToStaticMarkup(
      <section aria-labelledby={`${type}-1-heading`}>
        {renderSection(section, business, `${type}-1-heading`)}
      </section>,
    )
    expect(await violationsOf(html, `${type}/${variant}`)).toEqual([])
  })
})

describe('the whole page', () => {
  const spec = {
    specVersion: 1,
    site: {
      businessName: "Dave's Gas & Plumbing",
      industry: 'plumber',
      style: 'bold-trade',
      tone: 'direct',
      locale: 'en-AU',
      currency: 'AUD',
      showAbnInFooter: true,
    },
    theme: {
      primary: '#12324A',
      secondary: '#F3F5F7',
      accent: '#E4622B',
      neutral: '#16181A',
      headingFont: 'Archivo',
      bodyFont: 'Inter',
      radius: 'sm',
      density: 'comfortable',
      shadow: 'subtle',
      buttonStyle: 'solid',
      darkMode: false,
    },
    nav: {
      variant: 'simple',
      showPhone: true,
      items: [{ label: 'Services', href: '#services' }],
      cta: { label: 'Get a quote', href: '#contact', style: 'primary', icon: 'none' },
    },
    footer: { variant: 'columns', showServiceAreas: true, showHours: false, legalLinks: true },
    globals: {
      announcementBar: { text: 'Booking now for the Christmas shutdown.', variant: 'flat', dismissible: true },
      stickyCallBar: { enabled: true, label: 'Call Dave' },
      whatsappBubble: { enabled: true, prefillMessage: 'Hi Dave' },
    },
    pages: [
      {
        id: 'home',
        path: '/',
        title: 'Home',
        sections: [
          { id: 'hero-1', type: 'hero', variant: 'bold', hidden: false, background: 'default', spacing: 'lg', props: PROPS.hero },
          { id: 'svc-1', type: 'services', variant: 'cards', hidden: false, background: 'surface', spacing: 'lg', anchor: 'services', props: PROPS.services },
          { id: 'form-1', type: 'contactForm', variant: 'stacked', hidden: false, background: 'default', spacing: 'lg', anchor: 'contact', props: PROPS.contactForm },
        ],
      },
    ],
  } as never

  const html = () =>
    renderToStaticMarkup(
      <SpecRenderer spec={spec} page={(spec as never as { pages: never[] }).pages[0]!} business={business} />,
    )

  it('has no axe violations', async () => {
    expect(await violationsOf(html(), 'page')).toEqual([])
  })

  it('has exactly one h1 and no skipped heading levels', () => {
    document.body.innerHTML = html()
    expect(document.querySelectorAll('h1')).toHaveLength(1)

    const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) =>
      Number(h.tagName[1]),
    )
    let previous = 0
    for (const level of levels) {
      if (previous !== 0) expect(level, `jumped from h${previous} to h${level}`).toBeLessThanOrEqual(previous + 1)
      previous = level
    }
  })

  it('has the landmarks a screen reader navigates by', () => {
    document.body.innerHTML = html()
    expect(document.querySelector('header')).toBeTruthy()
    expect(document.querySelector('nav')).toBeTruthy()
    expect(document.querySelector('main')).toBeTruthy()
    expect(document.querySelector('footer')).toBeTruthy()
  })

  it('gives every form control a real label', () => {
    document.body.innerHTML = html()
    for (const el of document.querySelectorAll('input, select, textarea')) {
      const id = el.getAttribute('id')
      const labelled =
        (id && document.querySelector(`label[for="${id}"]`)) ||
        el.getAttribute('aria-label') ||
        el.closest('label')
      expect(labelled, `${el.tagName}#${id ?? '(no id)'} has no label`).toBeTruthy()
    }
  })

  it('keeps every tap target at 44px or more', () => {
    document.body.innerHTML = html()
    // jsdom has no layout, so assert on the utility classes that set the height.
    for (const el of document.querySelectorAll('a[href], button')) {
      const cls = el.getAttribute('class') ?? ''
      const inline = el.closest('p, li, blockquote, address, dd')
      if (inline) continue // links inside running text are exempt under WCAG 2.5.5
      expect(
        /min-h-1[1-9]|min-h-\d\d|h-1[1-9]|h-\d\d|py-2\.5|py-3/.test(cls),
        `tap target too small: <${el.tagName.toLowerCase()} class="${cls}">`,
      ).toBe(true)
    }
  })
})

describe('contrast', () => {
  it.each([
    ['#12324A', '#ffffff'], // deep navy
    ['#E4622B', '#000000'], // mid orange — white here is 3.45:1 and fails AA
    ['#F3F5F7', '#000000'], // near-white surface
    ['#173B2A', '#ffffff'], // forest green
    ['#C9A227', '#000000'], // gold
    ['#25D366', '#000000'], // whatsapp green
  ])('autoContrast(%s) picks %s', (bg, expected) => {
    expect(autoContrast(bg)).toBe(expected)
  })

  /**
   * The property that actually matters: whatever autoContrast returns must be legible.
   * Sampled across the hue wheel rather than on a handful of favourites, because the
   * bug this replaced only showed up on mid-tone colours.
   */
  it('always returns a foreground that passes WCAG AA for body text', () => {
    const failures: string[] = []
    for (let r = 0; r < 256; r += 51)
      for (let g = 0; g < 256; g += 51)
        for (let b = 0; b < 256; b += 51) {
          const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
          const ratio = contrastRatio(hex, autoContrast(hex))
          if (ratio < 4.5) failures.push(`${hex} -> ${autoContrast(hex)} = ${ratio.toFixed(2)}:1`)
        }
    expect(failures, `Colours with no legible foreground:\n  ${failures.join('\n  ')}`).toEqual([])
  })
})

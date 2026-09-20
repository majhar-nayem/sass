import { packFor } from './industry-hints.js'
import type { WebsiteSpec } from './spec.js'
import { validateSpec } from './validate.js'

/**
 * Templates: a complete specification built from the onboarding answers, with no model
 * call.
 *
 * Two reasons this exists rather than being a fallback nobody plans for. It is the floor
 * on quality — if a generated site is ever worse than this, the AI is not earning its
 * place (docs/09-GTM-FINANCE.md, R5). And it means onboarding works end to end when the
 * model is unavailable, rate-limited, or over budget, which on a signup flow is the
 * difference between a customer and a bounce.
 */

export interface TemplateBrief {
  businessName: string
  description: string
  industry: string
  suburb?: string | undefined
  state?: string | undefined
  services?: string[] | undefined
  phone?: string | undefined
  email?: string | undefined
  whatsapp?: string | undefined
  colours?: string | undefined
  style?: string | undefined
}

/** Maps the words owners use for colour onto a palette, falling back to the trade's. */
function palette(brief: TemplateBrief) {
  const hint = (brief.colours ?? '').toLowerCase()
  const packs = packFor(brief.industry).palettes
  const named: Array<[RegExp, { primary: string; accent: string; secondary: string; neutral: string }]> = [
    [/dark green|forest|olive/, { primary: '#173B2A', accent: '#C9A227', secondary: '#F5EEDC', neutral: '#1A1A1A' }],
    [/navy|dark blue/, { primary: '#12324A', accent: '#E4622B', secondary: '#F3F5F7', neutral: '#16181A' }],
    [/black|monochrome|charcoal/, { primary: '#151515', accent: '#B08D57', secondary: '#F2F2F0', neutral: '#0E0E0E' }],
    [/maroon|burgundy|deep red/, { primary: '#5A1F25', accent: '#D9A441', secondary: '#F7F1E6', neutral: '#191516' }],
    [/teal|aqua/, { primary: '#0F3B3A', accent: '#F0A202', secondary: '#F1F4F3', neutral: '#141716' }],
    [/terracotta|clay|warm/, { primary: '#3D2B23', accent: '#C4703A', secondary: '#F6F0E8', neutral: '#1C1714' }],
  ]
  for (const [re, p] of named) if (re.test(hint)) return p
  return packs[0]!
}

/**
 * Trims to fit a field, at a word boundary.
 *
 * site.businessName allows 80 characters; page.title and hero.heading allow 70. A real
 * trading name ("The Original Adelaide Hills Artisan Sourdough Bakery and Coffee House")
 * lands between the two, so without this the template throws partway through signup.
 */
function clamp(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}\u2026`
}

function tel(phone?: string): string | null {
  return phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : null
}

const FOOD = ['butcher', 'bakery', 'cafe', 'restaurant', 'grocer', 'caterer', 'food-truck', 'florist', 'gift-shop', 'retail']

/**
 * Builds a specification from the onboarding answers.
 *
 * Sections are included only when there is something real to put in them. An empty
 * testimonials block or a contact section with no contact details is worse than no
 * section — it reads as unfinished, which is exactly the impression this product exists
 * to avoid.
 */
export function buildFromTemplate(brief: TemplateBrief): WebsiteSpec {
  const pack = packFor(brief.industry)
  const p = palette(brief)
  const [headingFont, bodyFont] = pack.fonts[0]!
  const isFood = FOOD.includes(brief.industry)
  const where = brief.suburb ? ` in ${brief.suburb}` : ''
  const services = (brief.services ?? []).filter(Boolean).slice(0, 6)
  const phoneHref = tel(brief.phone)

  const sections: unknown[] = []

  sections.push({
    id: 'hero-main',
    type: 'hero',
    variant: isFood ? 'split' : 'bold',
    hidden: false,
    background: 'default',
    spacing: 'lg',
    props: {
      ...(brief.suburb ? { eyebrow: `${brief.suburb}${brief.state ? `, ${brief.state}` : ''}` } : {}),
      heading: clamp(brief.businessName, 70),
      subheading: clamp(brief.description, 200),
      ...(phoneHref
        ? { primaryCta: { label: `Call ${brief.phone}`, href: phoneHref, style: 'primary', icon: 'phone' } }
        : { primaryCta: { label: 'Get in touch', href: '#contact', style: 'primary', icon: 'arrow' } }),
      ...(phoneHref ? { secondaryCta: { label: 'Send an enquiry', href: '#contact', style: 'ghost', icon: 'quote' } } : {}),
      height: 'medium',
      align: 'left',
    },
  })

  if (services.length >= 2) {
    sections.push({
      id: 'services-1',
      type: 'services',
      variant: 'cards',
      hidden: false,
      background: 'surface',
      spacing: 'lg',
      anchor: 'services',
      props: {
        heading: isFood ? 'What we sell' : 'What we do',
        columns: services.length >= 4 ? 3 : services.length === 3 ? 3 : 2,
        items: services.map((title) => ({ title: clamp(title, 50) })),
      },
    })
  }

  sections.push({
    id: 'about-1',
    type: 'imageText',
    variant: 'stacked',
    hidden: false,
    background: 'default',
    spacing: 'lg',
    anchor: 'about',
    props: {
      heading: clamp(`About ${brief.businessName}`, 70),
      body: clamp(brief.description, 1200),
      ...(phoneHref ? { cta: { label: 'Get in touch', href: '#contact', style: 'ghost', icon: 'arrow' } } : {}),
    },
  })

  if (brief.phone || brief.email) {
    sections.push({
      id: 'contact-1',
      type: 'contact',
      variant: 'details',
      hidden: false,
      background: 'surface',
      spacing: 'lg',
      props: {
        heading: 'Get in touch',
        showPhone: Boolean(brief.phone),
        showEmail: Boolean(brief.email),
        showAddress: false,
        showHours: false,
        showServiceAreas: !isFood,
        showMap: false,
      },
    })
  }

  sections.push({
    id: 'enquiry-form',
    type: 'contactForm',
    variant: 'stacked',
    hidden: false,
    background: 'default',
    spacing: 'lg',
    anchor: 'contact',
    props: {
      heading: isFood ? 'Send us a message' : 'Ask for a quote',
      submitLabel: 'Send enquiry',
      fields: [
        { key: 'name', label: 'Your name', type: 'text', required: true },
        { key: 'phone', label: 'Phone', type: 'tel', required: true },
        ...(services.length >= 2
          ? [{ key: 'job_type', label: 'What do you need?', type: 'select', required: false, options: services }]
          : []),
        { key: 'message', label: 'Any details', type: 'textarea', required: false },
      ],
    },
  })

  const nav = [
    ...(services.length >= 2 ? [{ label: isFood ? 'What we sell' : 'Services', href: '#services' }] : []),
    { label: 'About', href: '#about' },
    { label: 'Contact', href: '#contact' },
  ]

  const spec = {
    specVersion: 1,
    site: {
      businessName: brief.businessName,
      tagline: clamp(brief.description, 140),
      industry: brief.industry,
      style: brief.style ?? (isFood ? 'warm-local' : 'bold-trade'),
      tone: isFood ? 'warm' : 'direct',
      locale: 'en-AU',
      currency: 'AUD',
      showAbnInFooter: true,
    },
    theme: {
      primary: p.primary,
      secondary: p.secondary,
      accent: p.accent,
      neutral: p.neutral,
      headingFont,
      bodyFont,
      radius: isFood ? 'md' : 'sm',
      density: 'comfortable',
      shadow: 'subtle',
      buttonStyle: 'solid',
      darkMode: false,
    },
    nav: { variant: 'simple', showPhone: Boolean(brief.phone), items: nav },
    footer: { variant: 'columns', showServiceAreas: !isFood, showHours: false, legalLinks: true },
    globals: {
      ...(brief.phone ? { stickyCallBar: { enabled: true, label: `Call ${brief.phone}` } } : {}),
      ...(brief.whatsapp ? { whatsappBubble: { enabled: true } } : {}),
    },
    pages: [
      {
        id: 'home',
        path: '/',
        title: clamp(`${brief.businessName}${where}`, 70),
        seo: {
          title: clamp(`${brief.businessName}${where}`, 60),
          description: clamp(brief.description, 160),
          noindex: false,
        },
        sections,
      },
    ],
  }

  // A template that produces an invalid spec is a bug in the template, and it must fail
  // here rather than at the renderer on a customer's first ever page view.
  const check = validateSpec(spec)
  if (!check.ok)
    throw new Error(
      `Template produced an invalid spec: ${check.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
    )
  return check.spec
}

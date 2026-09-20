/**
 * Seeds one published tenant site for local development.
 *
 * The spec is built through validateSpec, not written straight to the database — a
 * fixture that bypasses the gate would let an invalid spec into a table that is only
 * ever supposed to hold valid ones, and the renderer would then be debugging a problem
 * that cannot happen in production.
 *
 *   pnpm --filter @awning/db seed:demo
 */
import { randomUUID } from 'node:crypto'
import { validateSpec } from '@awning/spec'
import { rawPrisma } from './client.js'

const ROOT = process.env.SITES_ROOT_DOMAIN ?? 'awningsites.localhost'
const SLUG = 'daves-plumbing'

const draft = {
  specVersion: 1,
  site: {
    businessName: "Dave's Gas & Plumbing",
    tagline: 'Blocked drains and hot water, across northern Adelaide.',
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
    items: [
      { label: 'Services', href: '#services' },
      { label: 'About', href: '#about' },
      { label: 'Reviews', href: '#reviews' },
      { label: 'Contact', href: '#contact' },
    ],
    cta: { label: 'Get a quote', href: '#contact', style: 'primary', icon: 'quote' },
  },
  footer: { variant: 'columns', showServiceAreas: true, showHours: false, legalLinks: true },
  globals: {
    announcementBar: {
      text: 'Booking now for the Christmas shutdown — call before 15 December.',
      variant: 'flat',
      dismissible: true,
    },
    stickyCallBar: { enabled: true, label: 'Call Dave — 08 8123 4567' },
    whatsappBubble: { enabled: true, prefillMessage: 'Hi Dave, I need a plumber in ' },
  },
  pages: [
    {
      id: 'home',
      path: '/',
      title: "Dave's Gas & Plumbing — Salisbury",
      seo: {
        title: 'Plumber in Salisbury | Dave’s Gas & Plumbing',
        description:
          'Blocked drains, burst pipes and hot water repairs across northern Adelaide. Call 08 8123 4567.',
        noindex: false,
      },
      sections: [
        {
          id: 'hero-main',
          type: 'hero',
          variant: 'bold',
          hidden: false,
          background: 'default',
          spacing: 'lg',
          props: {
            eyebrow: 'Salisbury & northern suburbs',
            heading: 'Blocked drains cleared today',
            subheading:
              'Two vans on the road across northern Adelaide. Burst pipes, hot water and gas fitting. Call and speak to Dave, not a call centre.',
            primaryCta: {
              label: 'Call 08 8123 4567',
              href: 'tel:0881234567',
              style: 'primary',
              icon: 'phone',
            },
            secondaryCta: {
              label: 'Get a quote',
              href: '#contact',
              style: 'ghost',
              icon: 'quote',
            },
            trustPoints: ['On the road 6am–8pm', 'Upfront pricing', 'Same-day where we can'],
            height: 'medium',
            align: 'left',
          },
        },
        {
          id: 'services-grid',
          type: 'services',
          variant: 'cards',
          hidden: false,
          background: 'surface',
          spacing: 'lg',
          anchor: 'services',
          props: {
            heading: 'What we do',
            columns: 3,
            items: [
              {
                title: 'Blocked drains',
                description: 'Camera inspection and jet rodding. Most clears done in one visit.',
                icon: 'droplet',
                priceFrom: 'From $180',
              },
              {
                title: 'Hot water',
                description: 'Repairs and replacements, gas and electric. Same-day where we can.',
                icon: 'thermometer',
              },
              {
                title: 'Burst pipes',
                description: 'Emergency callouts across the northern suburbs.',
                icon: 'wrench',
              },
              {
                title: 'Gas fitting',
                description: 'Cooktops, heaters and gas lines.',
                icon: 'zap',
              },
            ],
          },
        },
        {
          id: 'about-dave',
          type: 'imageText',
          variant: 'left',
          hidden: false,
          background: 'default',
          spacing: 'lg',
          anchor: 'about',
          props: {
            heading: 'Dave, two vans and an apprentice',
            body: "I've been on the tools around the northern suburbs for a while now, and I still answer my own phone.\n\nIf I can't get to you the same day I'll tell you straight away rather than leaving you waiting. No call centre, no fuss.",
            cta: { label: 'Get a quote', href: '#contact', style: 'ghost', icon: 'quote' },
          },
        },
        {
          id: 'reviews',
          type: 'testimonials',
          variant: 'cards',
          hidden: false,
          background: 'surface',
          spacing: 'lg',
          anchor: 'reviews',
          props: {
            heading: 'What customers say',
            items: [
              {
                quote: 'Dave came out the same afternoon and had the drain cleared in an hour. Told me the price before he started.',
                author: 'Marie T.',
                location: 'Para Hills',
                rating: 5,
                source: 'customer_supplied',
              },
              {
                quote: 'Replaced our hot water system the day after it died. Tidy work and he cleaned up after himself.',
                author: 'Sam K.',
                location: 'Mawson Lakes',
                rating: 5,
                source: 'customer_supplied',
              },
            ],
          },
        },
        {
          id: 'xmas-countdown',
          type: 'countdown',
          variant: 'block',
          hidden: false,
          background: 'default',
          spacing: 'md',
          props: {
            heading: 'Last day for bookings before the Christmas shutdown',
            endsAt: '2026-12-15T17:00:00+10:30',
            expiredMessage: "We're back on the tools from 12 January.",
            cta: { label: 'Book before the break', href: '#contact', style: 'primary', icon: 'calendar' },
          },
        },
        {
          id: 'contact-details',
          type: 'contact',
          variant: 'split',
          hidden: false,
          background: 'default',
          spacing: 'lg',
          props: {
            heading: 'Get in touch',
            showPhone: true,
            showEmail: true,
            showAddress: false,
            showHours: true,
            showServiceAreas: true,
            showMap: false,
            note: 'After hours? Leave a message and Dave will call back first thing.',
          },
        },
        {
          id: 'quote-form',
          type: 'contactForm',
          variant: 'stacked',
          hidden: false,
          background: 'surface',
          spacing: 'lg',
          anchor: 'contact',
          props: {
            heading: 'Ask for a quote',
            subheading: 'Tell us what is going on and we will come back to you.',
            submitLabel: 'Send enquiry',
            successMessage: "Thanks — Dave will call you back today if it's before 4pm.",
            fields: [
              { key: 'name', label: 'Your name', type: 'text', required: true },
              { key: 'phone', label: 'Phone', type: 'tel', required: true },
              { key: 'job_type', label: 'What do you need?', type: 'select', required: true,
                options: ['Blocked drain', 'Hot water', 'Burst pipe', 'Gas fitting', 'Something else'] },
              { key: 'message', label: 'Any details', type: 'textarea', required: false,
                placeholder: 'Kitchen sink backing up since yesterday...' },
            ],
          },
        },
        {
          id: 'cta-close',
          type: 'cta',
          variant: 'banner',
          hidden: false,
          background: 'primary',
          spacing: 'md',
          props: {
            heading: 'Need a plumber today?',
            subheading: 'Call Dave direct. If it rings out, leave a message and he will call back.',
            primaryCta: {
              label: 'Call 08 8123 4567',
              href: 'tel:0881234567',
              style: 'primary',
              icon: 'phone',
            },
          },
        },
      ],
    },
  ],
}

async function main() {
  const result = validateSpec(draft)
  if (!result.ok) {
    console.error('Demo spec does not validate:')
    for (const e of result.errors) console.error(`  [${e.stage}] ${e.path} — ${e.message}`)
    process.exit(1)
  }

  await rawPrisma.organizations.deleteMany({ where: { slug: SLUG } })

  const orgId = randomUUID()
  const siteId = randomUUID()
  const versionId = randomUUID()

  await rawPrisma.organizations.create({
    data: { id: orgId, name: "Dave's Gas & Plumbing", slug: SLUG, state: 'SA', abn: '51824753556' },
  })
  await rawPrisma.sites.create({
    data: {
      id: siteId,
      org_id: orgId,
      name: "Dave's Gas & Plumbing",
      slug: SLUG,
      industry: 'plumber',
      status: 'published',
      business_phone: '08 8123 4567',
      business_email: 'dave@davesgasandplumbing.test',
      whatsapp_number: '0412 345 678',
      business_address: { suburb: 'Salisbury', state: 'SA', postcode: '5108' },
      service_areas: ['Salisbury', 'Elizabeth', 'Mawson Lakes', 'Para Hills', 'Ingle Farm'],
      socials: { facebook: 'https://facebook.com/example' },
      opening_hours: {
        monday: { open: '6:00am', close: '8:00pm' },
        tuesday: { open: '6:00am', close: '8:00pm' },
        wednesday: { open: '6:00am', close: '8:00pm' },
        thursday: { open: '6:00am', close: '8:00pm' },
        friday: { open: '6:00am', close: '8:00pm' },
        saturday: { open: '7:00am', close: '2:00pm' },
        sunday: null,
      },
    },
  })
  await rawPrisma.site_versions.create({
    data: {
      id: versionId,
      site_id: siteId,
      version: 1,
      spec_json: result.spec,
      spec_version: 1,
      created_by: 'system',
      summary: 'Demo seed',
    },
  })
  await rawPrisma.sites.update({
    where: { id: siteId },
    data: {
      draft_version_id: versionId,
      published_version_id: versionId,
      published_at: new Date(),
      first_published_at: new Date(),
      cache_epoch: { increment: 1 },
    },
  })
  await rawPrisma.site_domains.create({
    data: {
      site_id: siteId,
      hostname: `${SLUG}.${ROOT}`,
      kind: 'subdomain',
      status: 'active',
      is_primary: true,
      activated_at: new Date(),
    },
  })

  console.log(`seeded http://${SLUG}.${ROOT}  (site ${siteId})`)
  await rawPrisma.$disconnect()
}

void main()

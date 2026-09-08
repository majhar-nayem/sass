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
      { label: 'Contact', href: '#contact' },
    ],
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
          id: 'cta-close',
          type: 'cta',
          variant: 'banner',
          hidden: false,
          background: 'primary',
          spacing: 'md',
          anchor: 'contact',
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
      service_areas: ['Salisbury', 'Elizabeth', 'Mawson Lakes', 'Para Hills'],
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

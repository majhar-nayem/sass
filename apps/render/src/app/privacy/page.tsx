import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { withoutOrgContext } from '@awning/db'
import { generatePrivacyPolicy, type WebsiteSpec } from '@awning/spec'
import { resolveTenant } from '@awning/tenancy'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Privacy policy', robots: { index: false } }

/**
 * O-05 -- the tenant's privacy policy, generated from their site's real configuration.
 *
 * Every Australian small business needs one and almost none will write it, so the
 * footer links here on every site. It describes what the site actually does rather
 * than a template with blanks: no shop means no claims about payment processing.
 */
export default async function Privacy() {
  const host = (await headers()).get('host') ?? ''
  const tenant = await resolveTenant(host)
  if (!tenant) notFound()

  const site = await withoutOrgContext('tenant-resolution', (db) =>
    db.sites.findUnique({
      where: { id: tenant.siteId },
      select: {
        name: true,
        business_email: true,
        business_phone: true,
        business_address: true,
        organizations: { select: { abn: true } },
        store_settings: { select: { site_id: true } },
        site_versions_sites_published_version_idTosite_versions: { select: { spec_json: true } },
      },
    }),
  )
  if (!site) notFound()

  const spec = site.site_versions_sites_published_version_idTosite_versions?.spec_json as
    | WebsiteSpec
    | undefined
  // Widened to string: newsletter is in the catalogue's roadmap but not yet a built
  // component, and the policy has to stay correct either way.
  const types = new Set<string>(spec?.pages.flatMap((p) => p.sections.map((s) => s.type)) ?? [])
  const addr = site.business_address as { suburb?: string; state?: string } | null

  const markdown = generatePrivacyPolicy({
    businessName: site.name,
    abn: site.organizations?.abn ?? null,
    email: site.business_email,
    phone: site.business_phone,
    suburb: addr?.suburb ?? null,
    state: addr?.state ?? null,
    collects: {
      contactForm: types.has('contactForm'),
      newsletter: types.has('newsletter'),
      onlineOrders: site.store_settings !== null,
      // Cloudflare Web Analytics is cookieless and not linked to a person, which is
      // why these sites need no consent banner — but it is still disclosed.
      analytics: true,
    },
  })

  return (
    <main className="mx-auto max-w-[68ch] px-5 py-12">
      {markdown.split('\n').map((line, i) => {
        if (line.startsWith('# '))
          return (
            <h1 key={i} className="mb-4 text-2xl font-semibold">
              {line.slice(2)}
            </h1>
          )
        if (line.startsWith('## '))
          return (
            <h2 key={i} className="mt-8 mb-2 text-lg font-semibold">
              {line.slice(3)}
            </h2>
          )
        if (line.startsWith('- '))
          return (
            <li key={i} className="ml-5 list-disc leading-relaxed">
              {line.slice(2)}
            </li>
          )
        if (line === '---') return <hr key={i} className="my-8 border-current/15" />
        if (line.startsWith('*') && line.endsWith('*'))
          return (
            <p key={i} className="text-sm leading-relaxed opacity-65">
              {line.slice(1, -1)}
            </p>
          )
        if (line.trim() === '') return null
        return (
          <p key={i} className="mt-3 leading-relaxed">
            {line.replace(/\*\*(.+?)\*\*/g, '$1')}
          </p>
        )
      })}
    </main>
  )
}

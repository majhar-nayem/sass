import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { withoutOrgContext } from '@awning/db'
import { migrateSpec, validateSpec, type BusinessFacts, type WebsiteSpec } from '@awning/spec'
import { verifyPreviewToken } from '@awning/tenancy'
import { SpecRenderer } from '@awning/ui-blocks'

export const dynamic = 'force-dynamic'

// A preview is a draft of someone's business website. It must never be indexed, and it
// must never be cached anywhere between here and the editor's iframe.
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } }

export default async function Preview({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<{ t?: string; page?: string }>
}) {
  const { siteId } = await params
  const { t, page: pagePath } = await searchParams

  const claim = t ? verifyPreviewToken(t) : null
  // Checked against the path's siteId as well: a valid token for site A must not open
  // site B just because it is a valid token.
  if (!claim || claim.siteId !== siteId) notFound()

  const site = await withoutOrgContext('tenant-resolution', (db) =>
    db.sites.findUnique({
      where: { id: siteId },
      select: {
        name: true,
        business_phone: true,
        business_email: true,
        whatsapp_number: true,
        business_address: true,
        service_areas: true,
        socials: true,
        opening_hours: true,
        organizations: { select: { abn: true } },
        site_assets: { select: { id: true, public_url: true } },
        site_versions_sites_draft_version_idTosite_versions: { select: { spec_json: true } },
      },
    }),
  )

  const raw = site?.site_versions_sites_draft_version_idTosite_versions?.spec_json
  if (!raw) notFound()

  const check = validateSpec(migrateSpec(raw as never))
  if (!check.ok) {
    // Unlike the live renderer, a broken draft shows the reason: the person looking at
    // this is the owner mid-edit, and "something went wrong" helps nobody.
    return (
      <main style={{ maxWidth: 520, margin: '12vh auto', padding: '0 24px', fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: '1.2rem' }}>This draft can&rsquo;t be shown yet</h1>
        <ul style={{ opacity: 0.75, lineHeight: 1.6, fontSize: '.9rem' }}>
          {check.errors.slice(0, 5).map((e, i) => (
            <li key={i}>
              {e.path}: {e.message}
            </li>
          ))}
        </ul>
      </main>
    )
  }

  const spec: WebsiteSpec = check.spec
  const business: BusinessFacts = {
    businessName: site.name,
    phone: site.business_phone,
    email: site.business_email,
    whatsapp: site.whatsapp_number,
    abn: site.organizations?.abn ?? null,
    address: (site.business_address as BusinessFacts['address']) ?? null,
    serviceAreas: site.service_areas ?? [],
    socials: (site.socials as Record<string, string>) ?? {},
    openingHours: (site.opening_hours as BusinessFacts['openingHours']) ?? null,
  }

  const page = spec.pages.find((p) => p.path === (pagePath ?? '/')) ?? spec.pages[0]!
  // No host prop: structured data for a draft would advertise an unpublished site.
  const assets = Object.fromEntries(
    site.site_assets.map((a) => [`asset_${a.id.replace(/-/g, '')}`, a.public_url]),
  )
  return <SpecRenderer spec={spec} page={page} business={business} siteId={siteId} assets={assets} />
}

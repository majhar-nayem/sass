import { cache } from 'react'
import { withoutOrgContext } from '@awning/db'
import { migrateSpec, validateSpec, type BusinessFacts, type WebsiteSpec } from '@awning/spec'
import { resolveTenant, type TenantRef } from '@awning/tenancy'

export interface LoadedSite {
  tenant: TenantRef
  /** assetId -> public URL for every image this site owns. */
  assets: Record<string, string>
  spec: WebsiteSpec
  /** From the sites row, not the spec: these are facts, not design (see spec/business.ts). */
  business: BusinessFacts
}

export type LoadResult =
  | { kind: 'ok'; site: LoadedSite }
  | { kind: 'not-found' }
  | { kind: 'redirect'; to: string }
  // These three carry the tenant because they happen AFTER resolution. A broken live
  // site is the error that matters most here, and an untagged report of it says only
  // that something somewhere failed to render.
  | { kind: 'suspended'; tenant: TenantRef }
  | { kind: 'unpublished'; tenant: TenantRef }
  | { kind: 'broken'; tenant: TenantRef; reason: string }

/**
 * Host to rendered spec. The only path a public visitor takes.
 *
 * Wrapped in React's cache() because generateMetadata and the page component both need
 * it — without deduping, every tenant request costs two tenant resolutions and two spec
 * loads. The cache is per-request, so it cannot serve one tenant's spec to another.
 */
export const loadSiteByHost = cache(async function loadSiteByHost(
  host: string,
): Promise<LoadResult> {
  const tenant = await resolveTenant(host)
  if (!tenant) return { kind: 'not-found' }
  if (tenant.redirectTo) return { kind: 'redirect', to: tenant.redirectTo }
  if (tenant.status === 'suspended') return { kind: 'suspended', tenant }
  if (tenant.status !== 'published') return { kind: 'unpublished', tenant }

  const site = await withoutOrgContext('tenant-resolution', async (db) =>
    db.sites.findUnique({
      where: { id: tenant.siteId },
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
        site_versions_sites_published_version_idTosite_versions: { select: { spec_json: true } },
      },
    }),
  )

  const raw = site?.site_versions_sites_published_version_idTosite_versions?.spec_json
  if (!raw) return { kind: 'unpublished', tenant }

  // A stored spec may predate this build. Migrate on read; never rewrite the row.
  let migrated: unknown
  try {
    migrated = migrateSpec(raw as never)
  } catch (e) {
    return { kind: 'broken', tenant, reason: (e as Error).message }
  }

  // Published specs were validated before they were published, so a failure here means
  // the schema moved underneath a live site. Surface it rather than rendering partial.
  const result = validateSpec(migrated)
  if (!result.ok)
    return {
      kind: 'broken',
      tenant,
      reason: result.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('; '),
    }

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

  // Uploads belong to the tenant; stock is shared. Both resolve into one map so the
  // components never need to know which kind an id is.
  const [assetRows, stockRows] = await Promise.all([
    withoutOrgContext('tenant-resolution', (db) =>
      db.site_assets.findMany({ where: { site_id: tenant.siteId }, select: { id: true, public_url: true } }),
    ),
    withoutOrgContext('tenant-resolution', (db) =>
      db.stock_assets.findMany({ select: { id: true, public_url: true } }),
    ),
  ])
  const assets = {
    ...Object.fromEntries(stockRows.map((a) => [`stock:${a.id}`, a.public_url])),
    ...Object.fromEntries(assetRows.map((a) => [`asset_${a.id.replace(/-/g, '')}`, a.public_url])),
  }

  return { kind: 'ok', site: { tenant, spec: result.spec, business, assets } }
})

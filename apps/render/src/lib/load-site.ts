import { cache } from 'react'
import { withoutOrgContext } from '@awning/db'
import { migrateSpec, validateSpec, type WebsiteSpec } from '@awning/spec'
import { resolveTenant, type TenantRef } from '@awning/tenancy'

export interface LoadedSite {
  tenant: TenantRef
  spec: WebsiteSpec
}

export type LoadResult =
  | { kind: 'ok'; site: LoadedSite }
  | { kind: 'not-found' }
  | { kind: 'redirect'; to: string }
  | { kind: 'suspended' }
  | { kind: 'unpublished' }
  | { kind: 'broken'; reason: string }

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
  if (tenant.status === 'suspended') return { kind: 'suspended' }
  if (tenant.status !== 'published') return { kind: 'unpublished' }

  const site = await withoutOrgContext('tenant-resolution', async (db) =>
    db.sites.findUnique({
      where: { id: tenant.siteId },
      select: { site_versions_sites_published_version_idTosite_versions: { select: { spec_json: true } } },
    }),
  )

  const raw = site?.site_versions_sites_published_version_idTosite_versions?.spec_json
  if (!raw) return { kind: 'unpublished' }

  // A stored spec may predate this build. Migrate on read; never rewrite the row.
  let migrated: unknown
  try {
    migrated = migrateSpec(raw as never)
  } catch (e) {
    return { kind: 'broken', reason: (e as Error).message }
  }

  // Published specs were validated before they were published, so a failure here means
  // the schema moved underneath a live site. Surface it rather than rendering partial.
  const result = validateSpec(migrated)
  if (!result.ok)
    return { kind: 'broken', reason: result.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('; ') }

  return { kind: 'ok', site: { tenant, spec: result.spec } }
})

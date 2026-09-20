import { headers } from 'next/headers'
import { withoutOrgContext } from '@awning/db'
import { resolveTenant } from '@awning/tenancy'
import type { WebsiteSpec } from '@awning/spec'

export const dynamic = 'force-dynamic'

/** P-11 -- one sitemap per tenant, built from the published spec's pages. */
export async function GET() {
  const host = (await headers()).get('host') ?? ''
  const tenant = await resolveTenant(host)
  if (!tenant || tenant.status !== 'published') return new Response('Not found', { status: 404 })

  const site = await withoutOrgContext('tenant-resolution', (db) =>
    db.sites.findUnique({
      where: { id: tenant.siteId },
      select: {
        published_at: true,
        site_versions_sites_published_version_idTosite_versions: { select: { spec_json: true } },
      },
    }),
  )
  const spec = site?.site_versions_sites_published_version_idTosite_versions?.spec_json as WebsiteSpec | undefined
  if (!spec) return new Response('Not found', { status: 404 })

  const lastmod = (site?.published_at ?? new Date()).toISOString().slice(0, 10)
  const urls = spec.pages
    .filter((p) => !p.seo?.noindex)
    .map(
      (p) =>
        `  <url><loc>https://${host}${p.path === '/' ? '' : p.path}</loc>` +
        `<lastmod>${lastmod}</lastmod>` +
        `<priority>${p.path === '/' ? '1.0' : '0.7'}</priority></url>`,
    )

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' } },
  )
}

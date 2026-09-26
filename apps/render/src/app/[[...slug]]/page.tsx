import { headers } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import { SpecRenderer } from '@awning/ui-blocks'
import {
  enrichRequestContext,
  logger,
  reportError,
  requestIdFrom,
  runWithRequestContext,
} from '@awning/integrations/observability'
import { loadSiteByHost } from '@/lib/load-site'

// Tenant pages are per-host, so they cannot be prerendered at build time.
export const dynamic = 'force-dynamic'

function pathFrom(slug: string[] | undefined): string {
  return '/' + (slug ?? []).join('/')
}

async function hostname(): Promise<string> {
  const h = await headers()
  return h.get('host') ?? ''
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>
}): Promise<Metadata> {
  const result = await loadSiteByHost(await hostname())
  if (result.kind !== 'ok') return { title: 'Site not found', robots: { index: false } }

  const { slug } = await params
  const spec = result.site.spec
  const page = spec.pages.find((p) => p.path === pathFrom(slug))
  return {
    title: page?.seo?.title ?? page?.title ?? spec.site.businessName,
    description: page?.seo?.description ?? spec.site.tagline,
    robots: page?.seo?.noindex ? { index: false, follow: false } : undefined,
  }
}

export default async function TenantPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const h = await headers()
  const host = h.get('host') ?? ''
  // F-11: one request id for every line this request writes, taken from the edge when
  // Cloudflare or Fly already assigned one so the two sides of a hop join up.
  return runWithRequestContext(
    { requestId: requestIdFrom(h), service: 'render', route: '/[[...slug]]' },
    () => renderTenant(host, params),
  )
}

async function renderTenant(host: string, params: Promise<{ slug?: string[] }>) {
  const result = await loadSiteByHost(host)
  // Tag as soon as the tenant is known, so anything that throws below is attributable.
  const tenant = result.kind === 'ok' ? result.site.tenant : 'tenant' in result ? result.tenant : null
  if (tenant) enrichRequestContext({ siteId: tenant.siteId, orgId: tenant.orgId })

  switch (result.kind) {
    /**
     * Everything that is "no live site at this address" answers 404, deliberately —
     * including a suspended site. A 200 here would let Google index thousands of thin
     * pages across the wildcard domain, and would hide real outages from monitoring,
     * which cannot tell a served placeholder from a working website.
     */
    case 'not-found':
      return notFound()

    case 'unpublished':
      return notFound()

    case 'suspended':
      // Distinguished in the logs even though the visitor sees the same 404 — we do not
      // want a suspended site indexed either, and the owner is chased by email, not here.
      logger.warn('render.suspended', { host })
      return notFound()

    case 'redirect': {
      const { slug } = await params
      return permanentRedirect(`https://${result.to}${pathFrom(slug)}`)
    }

    /**
     * A published spec that no longer validates means a schema change reached a live
     * customer site. Throw: that is a 500, it pages someone, and it is never a partial
     * render of a business's website.
     */
    case 'broken': {
      // A schema change has reached a live customer site. This is the one that pages
      // someone, so it is reported explicitly rather than left to the generic handler.
      const err = new Error(`Unrenderable published spec for ${host}`)
      reportError(err, { host, reason: result.reason })
      throw err
    }

    case 'ok': {
      const { slug } = await params
      const page = result.site.spec.pages.find((p) => p.path === pathFrom(slug))
      if (!page) return notFound()
      return (
        <SpecRenderer
          spec={result.site.spec}
          page={page}
          business={result.site.business}
          host={host}
          siteId={result.site.tenant.siteId}
          assets={result.site.assets}
        />
      )
    }
  }
}

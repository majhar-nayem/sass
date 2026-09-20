import { headers } from 'next/headers'
import { resolveTenant } from '@awning/tenancy'

export const dynamic = 'force-dynamic'

export async function GET() {
  const host = (await headers()).get('host') ?? ''
  const tenant = await resolveTenant(host)

  // An unknown or unpublished host is disallowed outright. Without this, every
  // half-configured custom domain and every draft is a crawlable thin page under a
  // domain we own, which drags on the whole platform's standing in search.
  const body =
    tenant && tenant.status === 'published'
      ? `User-agent: *\nAllow: /\nDisallow: /preview/\nDisallow: /api/\n\nSitemap: https://${host}/sitemap.xml\n`
      : `User-agent: *\nDisallow: /\n`

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=3600' },
  })
}

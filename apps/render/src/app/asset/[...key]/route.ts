import { storage } from '@awning/integrations/storage'

export const dynamic = 'force-dynamic'

/**
 * Serves uploads in development, where there is no R2 and therefore no CDN in front.
 * In production CDN_BASE_URL points at Cloudflare and this route is never reached.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const s = storage()
  if (s.kind !== 'local' || !s.read) return new Response('Not found', { status: 404 })

  const { key } = await params
  const body = await s.read(key.join('/')).catch(() => null)
  if (!body) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

import { deepHealth } from '@awning/tenancy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Readiness: gates a deploy, so a machine that cannot reach its database never serves. */
export async function GET() {
  const h = await deepHealth('app')
  return Response.json(h, { status: h.ok ? 200 : 503 })
}

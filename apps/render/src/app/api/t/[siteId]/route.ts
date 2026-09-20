import { withoutOrgContext } from '@awning/db'

export const dynamic = 'force-dynamic'

/**
 * P-10 -- click tracking for the actions that matter.
 *
 * Only three events, all of them a visitor trying to make contact. This is not
 * analytics: it is the number that answers "is this website doing anything for me",
 * which is the question that decides whether a A$49 subscription gets cancelled.
 *
 * No cookie, no identifier, nothing per-person — a daily counter. That also means no
 * consent banner, which is a feature in itself.
 */
const EVENTS = new Set(['call', 'whatsapp', 'email', 'view'])

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params
  const event = new URL(req.url).searchParams.get('e') ?? ''
  if (!EVENTS.has(event)) return new Response(null, { status: 204 })

  const day = new Date()
  day.setUTCHours(0, 0, 0, 0)

  const column =
    event === 'call' ? 'phone_clicks' : event === 'whatsapp' ? 'whatsapp_clicks' : event === 'view' ? 'pageviews' : null
  if (!column) return new Response(null, { status: 204 })

  try {
    await withoutOrgContext('tenant-resolution', (db) =>
      db.$executeRawUnsafe(
        `INSERT INTO site_analytics_daily (site_id, day, ${column}) VALUES ($1::uuid, $2::date, 1)
         ON CONFLICT (site_id, day) DO UPDATE SET ${column} = site_analytics_daily.${column} + 1`,
        siteId,
        day.toISOString().slice(0, 10),
      ),
    )
  } catch {
    // A tracking failure must never be visible to a visitor mid-tap.
  }
  return new Response(null, { status: 204 })
}

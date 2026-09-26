import { timingSafeEqual } from 'node:crypto'
import { runDunning, sendDigest, sweepDomains } from '@awning/api'
import { withoutOrgContext } from '@awning/db'
import { reportError, requestIdFrom, runWithRequestContext } from '@awning/integrations/observability'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * The scheduled sweep. Fly cron (or any scheduler) hits this with a shared secret.
 *
 * A route rather than a separate worker process: it is two jobs a day, and a third
 * deployable to build, secure and operate would be a cost with no benefit at this size.
 * `deploy/schedule-cron.sh` points a Fly scheduled machine at it; the GitHub Actions
 * schedule in .github/workflows/cron.yml is the alternative when the hour matters.
 * When a job outgrows the 300s request budget, that is when it earns a worker app.
 */
function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const got = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  if (!authorised(req)) return new Response('Unauthorised', { status: 401 })

  const job = new URL(req.url).searchParams.get('job') ?? 'all'
  return runWithRequestContext(
    { requestId: requestIdFrom(req.headers), service: 'app', route: '/api/cron' },
    () => runJobs(job),
  )
}

async function runJobs(job: string) {
  const out: Record<string, unknown> = {}

  try {
    if (job === 'all' || job === 'domains')
      out.domains = await withoutOrgContext('cron', (db) => sweepDomains(db))
    if (job === 'all' || job === 'dunning')
      out.dunning = await withoutOrgContext('cron', (db) => runDunning(db))
    // Digest last: it reports on what the jobs above just did.
    if (job === 'all' || job === 'digest')
      out.digest = await withoutOrgContext('cron', (db) => sendDigest(db))
  } catch (e) {
    reportError(e, { job })
    return Response.json({ ok: false, error: (e as Error).message, partial: out }, { status: 500 })
  }

  return Response.json({ ok: true, ...out })
}

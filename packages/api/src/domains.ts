import { TRPCError } from '@trpc/server'
import type { PrismaTx } from '@awning/db'
import {
  cloudflareConfigured,
  cnameTarget,
  createCustomHostname,
  deleteCustomHostname,
  getCustomHostname,
} from '@awning/integrations/cloudflare'
import { normaliseHost } from '@awning/tenancy'

/**
 * O-01 -- custom domains.
 *
 * Concierge for now: an operator attaches the domain for the customer. At ten customers
 * that is five minutes each, against the ~30 hours a self-serve wizard and its eight
 * failure messages would cost (docs/10-SHIP10.md). The state machine and the messages
 * are built now because the wizard is the same logic with a form in front of it.
 */
export type DomainStatus = 'pending' | 'verifying' | 'ssl_pending' | 'active' | 'failed' | 'detached'

export interface DomainCheck {
  status: DomainStatus
  humanMessage: string | null
  errorCode: string | null
}

/**
 * The eight ways a domain gets stuck, in words the owner can act on.
 *
 * "CNAME record found but points to parking.godaddy.com — delete GoDaddy's parking
 * record first" prevents a twenty-minute phone call. Cloudflare's own text
 * ("verification_errors: pending_validation") prevents nothing.
 */
const DIAGNOSTICS: Array<[RegExp, string, string]> = [
  [
    /no.*(record|dns)|not found|nxdomain/i,
    'dns_missing',
    "We can't see the record yet. DNS changes can take up to 24 hours — we'll keep checking.",
  ],
  [
    /parking|parked/i,
    'dns_parked',
    "Your registrar's parking page is still there. Delete that record, then add ours.",
  ],
  [
    /caa/i,
    'caa_blocked',
    'Your domain has a CAA record that blocks us from getting a certificate. Add `0 issue "letsencrypt.org"` and we\'ll retry.',
  ],
  [
    /proxied|orange|cloudflare.*proxy/i,
    'cf_proxied',
    'Your domain is on Cloudflare — set the record to DNS only (grey cloud), not proxied.',
  ],
  [
    /cname.*conflict|mx.*cname|conflicting record/i,
    'apex_conflict',
    'That record clashes with your email. Point www at us instead and we\'ll redirect the bare domain.',
  ],
  [
    /expired|not registered/i,
    'domain_expired',
    "The domain looks expired or unregistered. Renew it with your registrar and we'll retry.",
  ],
  [
    /rate.?limit|too many/i,
    'rate_limited',
    "We're being rate-limited by the certificate authority. This usually clears within an hour.",
  ],
]

const STILL_WAITING =
  "Waiting on DNS. Once the record is in place we'll issue the certificate automatically — usually within a few minutes."

export function diagnose(errors: string[]): { code: string; message: string } {
  const text = errors.join(' ')
  for (const [re, code, message] of DIAGNOSTICS) if (re.test(text)) return { code, message }
  // An unrecognised Cloudflare error is still an error, but it is ours to read, not the
  // owner's — they get the neutral message and we get the raw text in the row.
  return errors.length
    ? { code: 'unknown', message: STILL_WAITING }
    : { code: 'waiting', message: STILL_WAITING }
}

/** Maps Cloudflare's vocabulary onto ours. */
export function statusFrom(cf: { status: string; sslStatus: string }): DomainStatus {
  if (cf.status === 'active' && cf.sslStatus === 'active') return 'active'
  if (cf.status === 'blocked' || cf.status === 'moved' || cf.status === 'deleted') return 'failed'
  if (cf.status === 'active') return 'ssl_pending'
  return 'verifying'
}

export class DomainRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DomainRejected'
  }
}

/** Rejects, with a reason, anything that cannot become a working custom domain. */
export function validateCustomHostname(input: string): string {
  const host = normaliseHost(input)
  if (!host) throw new DomainRejected('invalid', "That doesn't look like a domain name.")
  if (!host.includes('.')) throw new DomainRejected('invalid', 'A domain needs at least one dot.')
  if (host.length > 253) throw new DomainRejected('invalid', 'That domain is too long.')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host))
    throw new DomainRejected('invalid', 'Enter a domain name, not an IP address.')

  const root = process.env.SITES_ROOT_DOMAIN ?? 'awningsites.com'
  // Attaching a subdomain of our own wildcard as a "custom" hostname would fight the
  // subdomain router and produce a site reachable two ways with different certificates.
  if (host === root || host.endsWith(`.${root}`))
    throw new DomainRejected('own_domain', 'That address is already yours — you only need this for your own domain.')

  const appRoot = new URL(process.env.APP_URL ?? 'http://localhost').hostname
  if (host === appRoot || host.endsWith(`.${appRoot}`))
    throw new DomainRejected('reserved', 'That domain is reserved.')

  return host
}

export interface AttachResult {
  hostname: string
  status: DomainStatus
  cnameTarget: string
  txtName?: string | undefined
  txtValue?: string | undefined
  instructions: string
}

/**
 * Attaches a hostname to a site and registers it with Cloudflare.
 *
 * Both `www.x` and `x` are usually wanted; the caller decides which is primary and the
 * other redirects. Registered as `pending`/`verifying` and never as `active`: a hostname
 * only goes live once Cloudflare confirms ownership, which is what stops someone
 * claiming a domain they do not control (docs/07-SECURITY-OPS.md T4).
 */
export async function attachDomain(
  db: PrismaTx,
  siteId: string,
  rawHostname: string,
  opts: { primary?: boolean } = {},
): Promise<AttachResult> {
  const hostname = validateCustomHostname(rawHostname)

  const clash = await db.site_domains.findFirst({
    where: { hostname },
    select: { site_id: true, status: true },
  })
  if (clash && clash.site_id !== siteId)
    throw new DomainRejected('taken', 'That domain is already connected to another site.')

  let cfId: string | null = null
  let txtName: string | undefined
  let txtValue: string | undefined
  let status: DomainStatus = 'pending'

  if (cloudflareConfigured()) {
    const cf = await createCustomHostname(hostname)
    cfId = cf.id
    txtName = cf.verification.txtName
    txtValue = cf.verification.txtValue
    status = statusFrom(cf)
  }

  await db.site_domains.upsert({
    where: { hostname },
    create: {
      site_id: siteId,
      hostname,
      kind: 'custom',
      status,
      is_primary: opts.primary ?? false,
      cf_hostname_id: cfId,
      verification_txt: txtValue ?? null,
      last_checked_at: new Date(),
    },
    update: {
      site_id: siteId,
      status,
      cf_hostname_id: cfId,
      verification_txt: txtValue ?? null,
      last_checked_at: new Date(),
      error_code: null,
      error_message_human: null,
    },
  })

  const target = cnameTarget()
  return {
    hostname,
    status,
    cnameTarget: target,
    txtName,
    txtValue,
    instructions: [
      `Add these at your registrar:`,
      ``,
      `  Type: CNAME   Name: ${hostname.startsWith('www.') ? 'www' : '@'}   Value: ${target}`,
      ...(txtName && txtValue ? [`  Type: TXT     Name: ${txtName}   Value: ${txtValue}`] : []),
      ``,
      `Then we take it from there — the certificate is automatic.`,
    ].join('\n'),
  }
}

/**
 * Polls one pending hostname and advances its state.
 *
 * Run from the cron sweep rather than on a request: DNS propagation takes hours, and a
 * customer refreshing a page should never be what drives the check.
 */
export async function checkDomain(db: PrismaTx, domainId: string): Promise<DomainCheck> {
  const row = await db.site_domains.findUnique({
    where: { id: domainId },
    select: { id: true, hostname: true, cf_hostname_id: true, check_attempts: true, created_at: true },
  })
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })

  if (!row.cf_hostname_id || !cloudflareConfigured()) {
    return { status: 'pending', humanMessage: STILL_WAITING, errorCode: 'not_registered' }
  }

  let result: DomainCheck
  try {
    const cf = await getCustomHostname(row.cf_hostname_id)
    const status = statusFrom(cf)
    if (status === 'active') {
      result = { status, humanMessage: null, errorCode: null }
    } else {
      const d = diagnose(cf.errors)
      result = { status, humanMessage: d.message, errorCode: d.code }
    }
  } catch (e) {
    result = { status: 'verifying', humanMessage: STILL_WAITING, errorCode: 'cf_error' }
    console.error('[domains] Cloudflare check failed', row.hostname, (e as Error).message)
  }

  // Give up after 72 hours rather than polling a dead domain forever. The row stays so
  // an operator can see what happened and retry.
  const ageHours = (Date.now() - row.created_at.getTime()) / 3_600_000
  if (result.status !== 'active' && ageHours > 72) result.status = 'failed'

  await db.site_domains.update({
    where: { id: domainId },
    data: {
      status: result.status,
      error_code: result.errorCode,
      error_message_human: result.humanMessage,
      last_checked_at: new Date(),
      check_attempts: { increment: 1 },
      ...(result.status === 'active' ? { activated_at: new Date() } : {}),
    },
  })
  return result
}

/** Sweeps every domain still in flight. Called by the cron route. */
export async function sweepDomains(db: PrismaTx, limit = 50): Promise<{ checked: number; activated: number }> {
  const pending = await db.site_domains.findMany({
    where: { status: { in: ['pending', 'verifying', 'ssl_pending'] } },
    orderBy: { last_checked_at: 'asc' },
    take: limit,
    select: { id: true },
  })

  let activated = 0
  for (const d of pending) {
    const r = await checkDomain(db, d.id).catch(() => null)
    if (r?.status === 'active') activated++
  }
  return { checked: pending.length, activated }
}

export async function detachDomain(db: PrismaTx, domainId: string): Promise<void> {
  const row = await db.site_domains.findUnique({
    where: { id: domainId },
    select: { cf_hostname_id: true, kind: true },
  })
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  if (row.kind === 'subdomain')
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'The platform subdomain cannot be removed.' })

  if (row.cf_hostname_id && cloudflareConfigured())
    await deleteCustomHostname(row.cf_hostname_id).catch(() => {})

  await db.site_domains.update({
    where: { id: domainId },
    data: { status: 'detached', is_primary: false },
  })
}

import { withoutOrgContext } from '@awning/db'
import { enquiryEmail, sendMail } from '@awning/integrations/mail'
import { scoreSubmission, verifyTurnstile } from '@awning/integrations/turnstile'
import { hashIp, rateLimit } from '@awning/integrations/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * P-08 -- the public contact form endpoint.
 *
 * The most valuable thing the platform does for a tradie. Everything here is arranged
 * around one rule: never lose a real enquiry. Spam is filed, not discarded; a failed
 * notification email does not fail the request; and a full inbox is still a row in the
 * database the owner can open.
 */
const MAX_FIELD = 4000

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  return fwd?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || '0.0.0.0'
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ siteId: string; formKey: string }> },
) {
  const { siteId, formKey } = await params
  const ip = clientIp(req)

  // Per IP+site rather than per IP: a shared office NAT should not lock out a second
  // person enquiring with a different business.
  const limit = await rateLimit(`form:${siteId}:${ip}`, 5, 600)
  if (!limit.allowed)
    return Response.json(
      { ok: false, message: 'Too many messages just now. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )

  const fields: Record<string, string> = {}
  let honeypot: string | null = null
  let turnstileToken: string | null = null

  try {
    const contentType = req.headers.get('content-type') ?? ''
    const raw = contentType.includes('application/json')
      ? ((await req.json()) as Record<string, unknown>)
      : Object.fromEntries((await req.formData()).entries())

    for (const [k, v] of Object.entries(raw)) {
      if (typeof v !== 'string') continue
      if (k === 'company_website') honeypot = v
      else if (k === 'cf-turnstile-response') turnstileToken = v
      else fields[k] = v.slice(0, MAX_FIELD)
    }
  } catch {
    return Response.json({ ok: false, message: 'We could not read that form.' }, { status: 400 })
  }

  const site = await withoutOrgContext('tenant-resolution', (db) =>
    db.sites.findFirst({
      where: { id: siteId, status: { in: ['published', 'draft', 'unpublished'] } },
      select: {
        id: true, name: true, business_email: true, slug: true,
        site_domains: { where: { is_primary: true }, select: { hostname: true }, take: 1 },
      },
    }),
  )
  if (!site) return Response.json({ ok: false, message: 'Unknown form.' }, { status: 404 })

  const spam = scoreSubmission(fields, honeypot)
  const humanVerified = await verifyTurnstile(turnstileToken, ip)

  const notEmpty = Object.values(fields).some((v) => v.trim() !== '')
  if (!notEmpty)
    return Response.json({ ok: false, message: 'Please fill in the form before sending.' }, { status: 400 })

  const ipHash = await hashIp(ip)
  const submission = await withoutOrgContext('tenant-resolution', (db) =>
    db.form_submissions.create({
      data: {
        site_id: siteId,
        form_key: formKey.slice(0, 40),
        payload: fields as never,
        name: fields.name ?? fields.full_name ?? null,
        email: fields.email ?? null,
        phone: fields.phone ?? fields.mobile ?? null,
        message: fields.message ?? fields.details ?? null,
        source_path: req.headers.get('referer')?.slice(0, 500) ?? null,
        referrer: req.headers.get('referer')?.slice(0, 500) ?? null,
        ip_hash: ipHash,
        user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
        turnstile_passed: humanVerified,
        // Filed, never dropped. A false positive that silently eats a customer's
        // enquiry is far worse than a spam row in a folder nobody opens.
        is_spam: !spam.ok || !humanVerified,
        spam_score: spam.score,
      },
      select: { id: true },
    }),
  )

  if (spam.ok && humanVerified && site.business_email) {
    const host = site.site_domains[0]?.hostname ?? `${site.slug}.awningsites.com`
    const mail = enquiryEmail({
      businessName: site.name,
      siteHost: host,
      name: fields.name ?? null,
      phone: fields.phone ?? null,
      email: fields.email ?? null,
      message: fields.message ?? null,
      extra: Object.fromEntries(
        Object.entries(fields).filter(([k]) => !['name', 'phone', 'email', 'message'].includes(k)),
      ),
    })
    // Deliberately not awaited into the response path beyond this: the enquiry is
    // already saved, and the owner can see it in the inbox even if mail is down.
    const result = await sendMail({ ...mail, to: site.business_email, kind: 'tenant' })
    if (result.sent)
      await withoutOrgContext('tenant-resolution', (db) =>
        db.form_submissions.update({ where: { id: submission.id }, data: { notified_at: new Date() } }),
      )
  }

  // Spam gets the same response as a real enquiry. Telling a bot it was caught only
  // tells it what to change.
  return Response.json({ ok: true, message: "Thanks — we've got it." })
}

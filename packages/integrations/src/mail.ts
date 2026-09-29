import nodemailer, { type Transporter } from 'nodemailer'
import { reportError } from './observability.js'

/**
 * Transactional email.
 *
 * Two sending identities on purpose (docs/06-COMMERCE-BILLING.md §4): account and
 * billing mail, and mail triggered by a tenant's own visitors. A tenant whose enquiry
 * notifications get marked as spam must not damage the reputation of the domain that
 * sends "your payment failed".
 */
export type MailKind = 'platform' | 'tenant'

export interface Mail {
  to: string
  subject: string
  text: string
  html?: string
  replyTo?: string
  kind?: MailKind
  /**
   * Shown as "<name> via Awning". For mail a tenant's CUSTOMER receives: someone who
   * bought a ham from Dave should not get a confirmation from a company they have never
   * heard of — it reads as phishing.
   */
  fromName?: string
}

let transport: Transporter | null = null

function tx(): Transporter {
  if (transport) return transport
  const url = process.env.SMTP_URL
  if (url) {
    // Local development points at Mailpit, so the whole path is exercisable and every
    // message is inspectable at http://localhost:8025.
    transport = nodemailer.createTransport(url)
  } else if (process.env.RESEND_API_KEY) {
    transport = nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: process.env.RESEND_API_KEY },
    })
  } else {
    transport = nodemailer.createTransport({ jsonTransport: true })
  }
  return transport
}

export function __setTransport(t: Transporter | null): void {
  transport = t
}

/**
 * Swaps in a transport that captures instead of sending.
 *
 * Exported from here so a consumer's tests do not need nodemailer as a dependency just
 * to stub mail, and so nothing in a test run can accidentally reach a real inbox.
 */
export function __useCapturingTransport(): { sent: Mail[] } {
  const sent: Mail[] = []
  transport = {
    sendMail: async (m: Record<string, unknown>) => {
      sent.push(m as unknown as Mail)
      return { messageId: `captured-${sent.length}` }
    },
  } as unknown as Transporter
  return { sent }
}

function from(kind: MailKind): string {
  return kind === 'tenant'
    ? (process.env.MAIL_FROM_TENANT ?? 'Awning <notifications@send.awningsites.com>')
    : (process.env.MAIL_FROM_PLATFORM ?? 'Awning <hello@mail.awning.au>')
}

/**
 * Structured, not a string. A business name is tenant-controlled, and building
 * `"${name}" <addr>` by hand lets a name containing a line break write extra headers.
 * Nodemailer encodes the object form safely.
 */
function fromHeader(mail: Mail): string | { name: string; address: string } {
  const base = from(mail.kind ?? 'platform')
  if (!mail.fromName) return base
  const address = /<([^>]+)>/.exec(base)?.[1] ?? base
  const name = mail.fromName.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  return { name: `${name} via Awning`, address }
}

/**
 * Never throws. A failed notification must not roll back the enquiry that triggered it:
 * losing a tradie's lead because our mail provider blipped is far worse than a missing
 * email, and the row is in the inbox either way.
 */
export async function sendMail(mail: Mail): Promise<{ sent: boolean; error?: string }> {
  try {
    await tx().sendMail({
      from: fromHeader(mail),
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    })
    return { sent: true }
  } catch (e) {
    reportError(e, { step: 'mail-send' })
    return { sent: false, error: (e as Error).message }
  }
}

/** The email a tradie actually cares about. Plain text: it gets read on a phone, fast. */
export function enquiryEmail(input: {
  businessName: string
  siteHost: string
  name?: string | null
  phone?: string | null
  email?: string | null
  message?: string | null
  extra?: Record<string, unknown>
}): Pick<Mail, 'subject' | 'text' | 'replyTo'> {
  const lines = [
    `New enquiry from your website.`,
    '',
    `Name:    ${input.name ?? '—'}`,
    `Phone:   ${input.phone ?? '—'}`,
    `Email:   ${input.email ?? '—'}`,
  ]
  for (const [k, v] of Object.entries(input.extra ?? {}))
    if (v != null && String(v).trim()) lines.push(`${(k + ':').padEnd(9)}${String(v)}`)
  if (input.message) lines.push('', input.message)
  lines.push('', `— ${input.businessName} · ${input.siteHost}`)

  return {
    // The phone number in the subject means it is actionable from the lock screen.
    subject: `New enquiry${input.phone ? ` — ${input.phone}` : ''}${input.name ? ` (${input.name})` : ''}`,
    text: lines.join('\n'),
    ...(input.email ? { replyTo: input.email } : {}),
  }
}

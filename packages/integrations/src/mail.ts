import nodemailer, { type Transporter } from 'nodemailer'

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
 * Never throws. A failed notification must not roll back the enquiry that triggered it:
 * losing a tradie's lead because our mail provider blipped is far worse than a missing
 * email, and the row is in the inbox either way.
 */
export async function sendMail(mail: Mail): Promise<{ sent: boolean; error?: string }> {
  try {
    await tx().sendMail({
      from: from(mail.kind ?? 'platform'),
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    })
    return { sent: true }
  } catch (e) {
    console.error('[mail] send failed', (e as Error).message)
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

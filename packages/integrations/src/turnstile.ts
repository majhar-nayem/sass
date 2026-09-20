import { logger } from './observability.js'

/**
 * P-08 -- spam defence for public forms.
 *
 * Three layers, because each catches what the others miss: a honeypot stops
 * indiscriminate bots for free, Turnstile stops the ones that render JavaScript, and a
 * rate limit stops the one determined person with a script.
 */
export interface SpamCheck {
  ok: boolean
  score: number
  reason?: string
}

export async function verifyTurnstile(token: string | null, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET
  // Unconfigured means development. The honeypot and the rate limit still apply, so an
  // unconfigured environment is not an open door.
  if (!secret) return true
  if (!token) return false

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    })
    const body = (await res.json()) as { success?: boolean }
    return body.success === true
  } catch {
    // Cloudflare being unreachable must not silently drop a real customer's enquiry.
    logger.warn('turnstile.unreachable', { action: 'allowed-with-spam-score' })
    return true
  }
}

const LINK = /(https?:\/\/|www\.)/gi
const SPAMMY = /\b(seo services|backlinks|crypto|casino|viagra|loan offer|bitcoin|forex|rank #?1 on google)\b/i
const CYRILLIC = /[Ѐ-ӿ]/

/**
 * A heuristic score, not a verdict. Anything over the threshold is filed as spam rather
 * than discarded — a false positive that silently eats a customer's enquiry is worse
 * than a spam row in a folder the owner rarely opens.
 */
export function scoreSubmission(fields: Record<string, unknown>, honeypot: string | null): SpamCheck {
  if (honeypot && honeypot.trim() !== '')
    return { ok: false, score: 1, reason: 'honeypot' }

  const text = Object.values(fields)
    .filter((v) => typeof v === 'string')
    .join('\n')

  let score = 0
  const links = text.match(LINK)?.length ?? 0
  if (links >= 1) score += 0.3
  if (links >= 3) score += 0.4
  if (SPAMMY.test(text)) score += 0.5
  // Australian small-business enquiries are overwhelmingly in the Latin alphabet; this
  // is a weak signal on its own, which is why it is weighted low rather than blocking.
  if (CYRILLIC.test(text)) score += 0.3
  if (text.length > 4000) score += 0.2
  if (/(.)\1{15,}/.test(text)) score += 0.3

  return { ok: score < 0.7, score: Math.min(score, 1), ...(score >= 0.7 ? { reason: 'content' } : {}) }
}

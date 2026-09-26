/**
 * O-05b -- who else handles a tenant's data, and where.
 *
 * Machine-readable because the generated privacy policy on every customer's website
 * makes a factual claim about it. The first version of that policy said personal
 * information is stored "on secure servers in Australia" and stopped there — while
 * enquiry notifications, which carry the enquirer's name, phone number and message,
 * were being sent through a provider in the United States.
 *
 * That is an unverified assertion published on a customer's site as fact, which is the
 * same failure the banned-claims validator exists to prevent. The difference is that we
 * wrote this one.
 *
 * Keep in step with docs/legal/SUBPROCESSORS.md.
 */
export interface Subprocessor {
  name: string
  purpose: string
  /** Does this provider receive personal information about the tenant's customers? */
  handlesPersonalInfo: boolean
  country: 'AU' | 'US' | 'global'
  /** Only named in a tenant's policy when the site is configured to use it. */
  appliesWhen?: 'always' | 'onlineOrders' | 'contactForm'
}

export const SUBPROCESSORS: readonly Subprocessor[] = [
  { name: 'Neon', purpose: 'database', handlesPersonalInfo: true, country: 'AU', appliesWhen: 'always' },
  { name: 'Fly.io', purpose: 'application servers', handlesPersonalInfo: true, country: 'AU', appliesWhen: 'always' },
  { name: 'Cloudflare', purpose: 'images, DNS and caching', handlesPersonalInfo: false, country: 'global', appliesWhen: 'always' },
  { name: 'Resend', purpose: 'sending enquiry notifications', handlesPersonalInfo: true, country: 'US', appliesWhen: 'contactForm' },
  { name: 'Stripe', purpose: 'payments', handlesPersonalInfo: true, country: 'global', appliesWhen: 'onlineOrders' },
  { name: 'Anthropic', purpose: 'generating website copy', handlesPersonalInfo: false, country: 'US', appliesWhen: 'always' },
  { name: 'Sentry', purpose: 'error reports, with personal information removed', handlesPersonalInfo: false, country: 'global', appliesWhen: 'always' },
]

/** The overseas recipients of personal information, for a site with these features. */
export function overseasRecipients(collects: {
  contactForm: boolean
  onlineOrders: boolean
}): Subprocessor[] {
  return SUBPROCESSORS.filter((s) => {
    if (!s.handlesPersonalInfo || s.country === 'AU') return false
    if (s.appliesWhen === 'contactForm') return collects.contactForm
    if (s.appliesWhen === 'onlineOrders') return collects.onlineOrders
    return true
  })
}

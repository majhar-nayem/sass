import { describe, expect, it } from 'vitest'
import { generatePrivacyPolicy } from '../privacy-policy.js'
import { overseasRecipients, SUBPROCESSORS } from '../subprocessors.js'

/**
 * O-05 / O-05b. This generates a legal document that appears on a customer's website
 * and is a representation THEY make to THEIR customers. It has to describe what the
 * site actually does — an inaccuracy here is their exposure, created by us.
 */
const collects = (over: Partial<Record<string, boolean>> = {}) => ({
  contactForm: false, newsletter: false, onlineOrders: false, analytics: false, ...over,
}) as { contactForm: boolean; newsletter: boolean; onlineOrders: boolean; analytics: boolean }

const policy = (over = {}, c = collects()) =>
  generatePrivacyPolicy({ businessName: "Dave's Plumbing", collects: c, ...over })

describe('it describes the site it is actually for', () => {
  it('a brochure site says it collects nothing, rather than boilerplate', () => {
    const p = policy()
    expect(p).toContain('does not collect personal information')
    // It may still mention an enquiry form to say there isn't one; what it must not do
    // is list things it collects.
    expect(p).not.toContain('We collect:')
  })

  it('does not promise an unsubscribe link that does not exist', () => {
    expect(policy({}, collects({ contactForm: true }))).not.toContain('unsubscribe')
    expect(policy({}, collects({ newsletter: true }))).toContain('unsubscribe')
  })

  it('only mentions payments when there is a shop', () => {
    expect(policy({}, collects({ contactForm: true }))).not.toContain('Stripe')
    expect(policy({}, collects({ onlineOrders: true }))).toContain('Stripe')
  })

  it('keeps order records for seven years only when there are orders', () => {
    expect(policy({}, collects({ onlineOrders: true }))).toContain('seven years')
    expect(policy({}, collects({ contactForm: true }))).not.toContain('seven years')
  })

  it('never invents an ABN', () => {
    expect(policy()).not.toContain('ABN')
    expect(policy({ abn: '51824753556' })).toContain('ABN 51 824 753 556')
  })
})

/**
 * APP 8. The first version of this said everything was stored on "secure servers in
 * Australia" and stopped — while enquiry notifications, carrying the enquirer's name,
 * phone and message, were going through a provider in the United States.
 */
describe('overseas disclosure', () => {
  it('a site that sends nothing overseas does not claim that it does', () => {
    expect(policy()).not.toContain('outside Australia')
  })

  it('an enquiry form means email leaves the country, and the policy says so', () => {
    const p = policy({}, collects({ contactForm: true }))
    expect(p).toContain('outside Australia')
    expect(p).toContain('Resend (United States)')
  })

  it('a shop adds the payment processor to the same sentence', () => {
    const p = policy({}, collects({ contactForm: true, onlineOrders: true }))
    expect(p).toMatch(/Resend \(United States\) and Stripe \([^)]+\) are providers/)
  })

  it('does not name a provider that receives no personal information', () => {
    // Anthropic sees the business's own copy; Sentry's payloads are scrubbed. Naming
    // them would overstate the disclosure just as badly as omitting Resend understated it.
    const p = policy({}, collects({ contactForm: true, onlineOrders: true }))
    expect(p).not.toContain('Anthropic')
    expect(p).not.toContain('Sentry')
  })
})

describe('the subprocessor register', () => {
  it('every entry that handles personal information says where it is', () => {
    for (const s of SUBPROCESSORS)
      if (s.handlesPersonalInfo) expect(['AU', 'US', 'global']).toContain(s.country)
  })

  it('an Australian provider is never listed as an overseas recipient', () => {
    const names = overseasRecipients({ contactForm: true, onlineOrders: true }).map((s) => s.name)
    expect(names).not.toContain('Neon')
    expect(names).not.toContain('Fly.io')
  })

  // If someone adds a provider that receives enquiry data, the policy must follow.
  it('names every overseas recipient of personal information for a full-featured site', () => {
    const expected = SUBPROCESSORS.filter((s) => s.handlesPersonalInfo && s.country !== 'AU')
    const p = policy({}, collects({ contactForm: true, onlineOrders: true }))
    for (const s of expected) expect(p).toContain(s.name)
  })
})

/**
 * O-05 -- a privacy policy generated from what a site actually collects.
 *
 * Every tenant needs one and almost none of them will write it. Generating it from the
 * site's real configuration — rather than handing over a template with blanks — means
 * it describes what is true: a site with no shop does not claim to process payments,
 * and a site with no newsletter does not promise an unsubscribe link that isn't there.
 *
 * This is a plain-language notice, not legal advice. A business whose circumstances are
 * unusual needs a lawyer, and the page says so.
 */
export interface PolicyInputs {
  businessName: string
  /** Australian Business Number, if the owner entered one. Never invented. */
  abn?: string | null
  email?: string | null
  phone?: string | null
  suburb?: string | null
  state?: string | null
  /** What the site is actually configured to do. */
  collects: {
    contactForm: boolean
    newsletter: boolean
    onlineOrders: boolean
    analytics: boolean
  }
  updatedAt?: Date
}

const AU_DATE = (d: Date) =>
  d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })

export function generatePrivacyPolicy(input: PolicyInputs): string {
  const { businessName: name, collects } = input
  const when = AU_DATE(input.updatedAt ?? new Date())

  const collected: string[] = []
  if (collects.contactForm)
    collected.push(
      'your name, phone number, email address and whatever you write in the message, when you use the enquiry form',
    )
  if (collects.newsletter) collected.push('your email address, if you sign up for updates')
  if (collects.onlineOrders)
    collected.push(
      'your name, contact details and delivery address when you place an order, along with what you ordered',
    )
  if (collects.analytics)
    collected.push('anonymous information about which pages are visited, which is not linked to you')

  const sections: string[] = [
    `# Privacy policy`,
    ``,
    `**${name}**${input.abn ? ` (ABN ${formatAbn(input.abn)})` : ''} respects your privacy. This page explains what we collect through this website and what we do with it.`,
    ``,
    `Last updated: ${when}.`,
    ``,
    `## What we collect`,
    ``,
  ]

  if (collected.length === 0) {
    // A brochure site genuinely collects nothing, and saying so is both true and more
    // reassuring than a page of boilerplate about data we never touch.
    sections.push(
      `This website does not collect personal information. There is no enquiry form, no sign-up and no online ordering — if you want to get in touch, the contact details on the site go straight to us.`,
    )
  } else {
    sections.push(`We collect:`, ``, ...collected.map((c) => `- ${c}`))
  }

  sections.push(
    ``,
    `We do not collect anything else, and we do not ask for information we do not need.`,
    ``,
    `## Why we collect it`,
    ``,
  )

  const purposes: string[] = []
  if (collects.contactForm) purposes.push('to reply to your enquiry and quote for the work')
  if (collects.newsletter) purposes.push('to send you updates you asked for')
  if (collects.onlineOrders) purposes.push('to take payment, fulfil your order and contact you about it')
  if (collects.analytics) purposes.push('to understand which pages are useful')
  sections.push(
    purposes.length
      ? `We use it ${purposes.join(', and ')}. We do not use it for anything else.`
      : `Not applicable — we do not collect personal information through this site.`,
  )

  if (collects.newsletter)
    sections.push(
      ``,
      `You can unsubscribe from updates at any time using the link in any email we send, and we will stop.`,
    )

  sections.push(
    ``,
    `## Who else sees it`,
    ``,
    `We do not sell your information and we do not share it for marketing.`,
    ``,
    `Our website is built and hosted by Awning, which stores the information on secure servers in Australia on our behalf.`,
  )
  if (collects.onlineOrders)
    sections.push(
      ``,
      `Payments are handled by Stripe. Your card details go directly to Stripe and are never stored by us — we only see that a payment succeeded and what you ordered.`,
    )

  sections.push(
    ``,
    `## How long we keep it`,
    ``,
    collects.onlineOrders
      ? `Enquiries are kept for two years. Order records are kept for seven years, because tax law requires it. After that they are deleted.`
      : `Enquiries are kept for two years and then deleted.`,
    ``,
    `## Your rights`,
    ``,
    `Under the Australian Privacy Principles you can ask us what personal information we hold about you, ask us to correct it, and ask us to delete it. Just get in touch and we will sort it out — there is no charge and no form to fill in.`,
    ``,
    `If you are not happy with how we have handled your information you can complain to the Office of the Australian Information Commissioner at oaic.gov.au.`,
    ``,
    `## Contact`,
    ``,
    `${name}`,
  )
  if (input.email) sections.push(input.email)
  if (input.phone) sections.push(input.phone)
  if (input.suburb) sections.push([input.suburb, input.state].filter(Boolean).join(', '))

  sections.push(
    ``,
    `---`,
    ``,
    `*This notice was generated from how this website is set up. It covers the ordinary case. If your business handles health records, credit reporting, tax file numbers or children's information, get advice — those carry extra obligations this page does not cover.*`,
  )

  return sections.join('\n')
}

function formatAbn(abn: string): string {
  const d = abn.replace(/\D/g, '')
  return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : abn
}

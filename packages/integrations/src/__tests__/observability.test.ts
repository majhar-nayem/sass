import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentContext,
  enrichRequestContext,
  logger,
  redactText,
  reportError,
  requestIdFrom,
  runWithRequestContext,
  scrub,
  scrubEvent,
  setErrorReporter,
} from '../observability.js'

/**
 * F-11. The scrubber is the part that must not be trusted on inspection.
 *
 * This platform holds enquiry forms full of names, phone numbers and addresses
 * belonging to people who gave them to a plumber, not to us. Forwarding those to an
 * error tracker is a privacy breach, and it happens silently by default — inside a
 * request body, a breadcrumb or someone's debugging extras.
 */
describe('redaction', () => {
  it('removes an email address from free text', () => {
    expect(redactText('reply to dave@example.com.au please')).toBe('reply to [email] please')
  })

  it('removes Australian phone numbers as people actually type them', () => {
    for (const n of [
      '0412 345 678', '0412345678', '(08) 8123 4567', '08 8123 4567',
      '0881234567', '+61 412 345 678', '+61 8 8123 4567',
    ])
      expect(redactText(`call ${n} today`)).toBe('call [phone] today')
  })

  // An over-eager number pattern makes logs useless in a different way.
  it('leaves numbers that are not phone numbers alone', () => {
    for (const s of ['order 12345678 shipped', 'ABN 51 824 753 556', 'in 2026 we', '$1,200.00'])
      expect(redactText(s)).toBe(s)
  })

  it('redacts by key name, not by how the value looks', () => {
    // `customerEmail: ''` is still personal information, and a name never matches a
    // pattern. Guessing from the value alone misses both.
    const out = scrub({ customerEmail: '', fullName: 'Dave Smith', suburb: 'Salisbury' }) as Record<string, unknown>
    expect(out).toEqual({ customerEmail: '[personal]', fullName: '[personal]', suburb: '[personal]' })
  })

  it('redacts secrets outright', () => {
    const out = scrub({
      stripeSecretKey: 'sk_live_abc',
      authorization: 'Bearer xyz',
      cookie: 'session=1',
      apiToken: 't',
    }) as Record<string, string>
    for (const v of Object.values(out)) expect(v).toBe('[redacted]')
  })

  it('reaches personal data nested inside ordinary-looking structures', () => {
    const out = scrub({ submission: { fields: { email: 'a@b.com', enquiry: 'ring me on 0412 345 678' } } })
    expect(JSON.stringify(out)).not.toContain('a@b.com')
    expect(JSON.stringify(out)).not.toContain('0412')
  })

  it('keeps the things that make an error diagnosable', () => {
    const out = scrub({ statusCode: 500, retryCount: 2, ok: false }) as Record<string, unknown>
    expect(out).toEqual({ statusCode: 500, retryCount: 2, ok: false })
  })

  // A substring match reads "description" as containing "ip" and "hostname" as
  // containing "name", quietly deleting exactly what you need to debug with.
  it('matches key names by segment, not by substring', () => {
    const out = scrub({
      description: 'a butcher shop', hostname: 'daves.awningsites.com',
      keyword: 'plumber', sectionId: 'hero-main',
    }) as Record<string, unknown>
    expect(out).toEqual({
      description: 'a butcher shop', hostname: 'daves.awningsites.com',
      keyword: 'plumber', sectionId: 'hero-main',
    })
  })

  it('does not recurse forever on a cyclic object', () => {
    const a: Record<string, unknown> = { n: 1 }
    a.self = a
    expect(() => scrub(a)).not.toThrow()
  })
})

describe('request context', () => {
  it('carries a request id across async boundaries', async () => {
    await runWithRequestContext({ requestId: 'req-1', service: 'render' }, async () => {
      await new Promise((r) => setTimeout(r, 1))
      expect(currentContext()?.requestId).toBe('req-1')
    })
  })

  // The tenant is only known part-way through: tRPC verifies membership first.
  it('can be enriched once the tenant is known', () => {
    runWithRequestContext({ requestId: 'req-2' }, () => {
      enrichRequestContext({ orgId: 'org-9', siteId: 'site-9' })
      expect(currentContext()).toMatchObject({ requestId: 'req-2', orgId: 'org-9', siteId: 'site-9' })
    })
  })

  it('does not leak between two requests', () => {
    runWithRequestContext({ requestId: 'a' }, () => enrichRequestContext({ orgId: 'org-a' }))
    runWithRequestContext({ requestId: 'b' }, () => expect(currentContext()?.orgId).toBeUndefined())
  })

  it('adopts an id the edge already assigned, so hops join up', () => {
    expect(requestIdFrom(new Headers({ 'cf-ray': 'ray-123' }))).toBe('ray-123')
    expect(requestIdFrom(new Headers()).length).toBeGreaterThan(10)
  })
})

describe('structured logs', () => {
  afterEach(() => vi.restoreAllMocks())

  const capture = (fn: () => void): Record<string, unknown> => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = vi.spyOn(console, 'log').mockImplementation(() => {})
    fn()
    const line = (spy.mock.calls[0]?.[0] ?? out.mock.calls[0]?.[0]) as string
    return JSON.parse(line)
  }

  it('emits one JSON object carrying the request id and tenant', () => {
    const line = capture(() =>
      runWithRequestContext({ requestId: 'r-7', service: 'render', orgId: 'o-1', siteId: 's-1' }, () =>
        logger.info('render.done', { ms: 12 }),
      ),
    )
    expect(line).toMatchObject({
      level: 'info', event: 'render.done', request_id: 'r-7',
      service: 'render', org_id: 'o-1', site_id: 's-1', ms: 12,
    })
  })

  it('scrubs the fields a caller passes without being asked', () => {
    const line = capture(() => logger.warn('form.rejected', { email: 'dave@example.com' }))
    expect(line.email).toBe('[personal]')
  })
})

describe('error reporting', () => {
  afterEach(() => {
    setErrorReporter(null)
    vi.restoreAllMocks()
  })

  it('tags the report with the tenant it happened to', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen: Array<{ tags: Record<string, string> }> = []
    setErrorReporter((_e, c) => seen.push(c))

    runWithRequestContext({ requestId: 'r', service: 'render', orgId: 'org-4', siteId: 'site-4' }, () =>
      reportError(new Error('boom')),
    )
    expect(seen[0]?.tags).toMatchObject({ org_id: 'org-4', site_id: 'site-4', service: 'render' })
  })

  it('scrubs the extras on the way out', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen: Array<{ extra: Record<string, unknown> }> = []
    setErrorReporter((_e, c) => seen.push(c))
    reportError(new Error('boom'), { email: 'dave@example.com', siteHost: 'x.com' })
    expect(seen[0]?.extra.email).toBe('[personal]')
  })

  // An error tracker that throws must not become the outage.
  it('survives a reporter that throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setErrorReporter(() => {
      throw new Error('sentry is down')
    })
    expect(() => reportError(new Error('boom'))).not.toThrow()
  })

  it('still logs when no reporter is registered', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportError(new Error('boom'))
    expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toMatchObject({ level: 'error', err: 'boom' })
  })
})

describe('outbound Sentry events', () => {
  const event = () => ({
    request: {
      url: 'https://daves.awningsites.com/contact?email=dave@example.com&token=abc123',
      query_string: 'email=dave@example.com&token=abc123',
      cookies: { session: 'supersecret' },
      data: { name: 'Dave', phone: '0412 345 678' },
      headers: { host: 'daves.awningsites.com', cookie: 'session=x', authorization: 'Bearer y' },
    },
    user: { id: 'u1', email: 'dave@example.com' },
    extra: { enquiryEmail: 'customer@example.com', siteHost: 'daves.awningsites.com' },
  })

  it('drops the body, the cookies and the user', () => {
    const e = scrubEvent(event())
    expect(e.request.data).toBeUndefined()
    expect(e.request.cookies).toBeUndefined()
    expect(e.user).toBeUndefined()
  })

  // The trap: deleting query_string alone leaves the identical values in `url`, which
  // is the copy that actually goes over the wire.
  it('strips the query from the url, not just the query_string field', () => {
    const e = scrubEvent(event())
    expect(e.request.url).toBe('https://daves.awningsites.com/contact')
    expect(e.request.query_string).toBeUndefined()
  })

  it('redacts credential headers but keeps the host', () => {
    const e = scrubEvent(event())
    expect(e.request.headers.cookie).toBe('[redacted]')
    expect(e.request.headers.authorization).toBe('[redacted]')
    expect(e.request.headers.host).toBe('daves.awningsites.com')
  })

  it('leaves nothing personal anywhere in the serialised event', () => {
    const json = JSON.stringify(scrubEvent(event()))
    for (const secret of ['dave@example.com', 'abc123', 'supersecret', '0412', 'customer@example.com'])
      expect(json).not.toContain(secret)
  })
})

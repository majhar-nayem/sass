import { beforeAll, describe, expect, it } from 'vitest'
import { createPreviewToken, verifyPreviewToken } from '../preview-token.js'

/**
 * A preview token is the only thing standing between a draft of someone's business
 * website and the open internet, so the failure modes are worth stating explicitly.
 */
beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ??= 'test-secret-0123456789abcdef'
})

const SITE = '11111111-2222-3333-4444-555555555555'

describe('preview tokens', () => {
  it('round-trips', () => {
    expect(verifyPreviewToken(createPreviewToken(SITE))?.siteId).toBe(SITE)
  })

  it('rejects a tampered signature', () => {
    const t = createPreviewToken(SITE)
    expect(verifyPreviewToken(`${t.slice(0, -1)}X`)).toBeNull()
  })

  /** Swapping the site id must not work: the id is inside the signed payload. */
  it('rejects a token re-pointed at another site', () => {
    const t = createPreviewToken(SITE)
    const [, exp, mac] = t.split('.')
    expect(verifyPreviewToken(`00000000-0000-0000-0000-000000000000.${exp}.${mac}`)).toBeNull()
  })

  it('rejects an extended expiry', () => {
    const [id, , mac] = createPreviewToken(SITE).split('.')
    const far = Math.floor(Date.now() / 1000) + 86_400 * 365
    expect(verifyPreviewToken(`${id}.${far}.${mac}`)).toBeNull()
  })

  /** A link pasted into a chat has to stop working. */
  it('expires after an hour', () => {
    const t = createPreviewToken(SITE)
    expect(verifyPreviewToken(t, Date.now() + 61 * 60_000)).toBeNull()
    expect(verifyPreviewToken(t, Date.now() + 59 * 60_000)?.siteId).toBe(SITE)
  })

  it.each(['', 'garbage', 'a.b', 'a.b.c.d', `${SITE}.notanumber.sig`])(
    'rejects malformed token %s',
    (t) => expect(verifyPreviewToken(t)).toBeNull(),
  )

  it('is not forgeable with a different secret', () => {
    const t = createPreviewToken(SITE)
    const original = process.env.BETTER_AUTH_SECRET
    process.env.BETTER_AUTH_SECRET = 'a-completely-different-secret'
    expect(verifyPreviewToken(t)).toBeNull()
    process.env.BETTER_AUTH_SECRET = original
  })
})

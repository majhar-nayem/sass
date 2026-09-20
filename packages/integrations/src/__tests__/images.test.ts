import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { hasExif, processUpload, sniffFormat, UnsupportedImage } from '../images.js'
import { assetKey } from '../storage.js'
import { scoreSubmission } from '../turnstile.js'

async function jpeg(width = 800, height = 600, withExif = false): Promise<Buffer> {
  let p = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 60 } },
  })
  if (withExif)
    // sharp's Exif type does not declare a GPS block, though it writes one. Casting is
    // the point of the test: we need a fixture that genuinely carries coordinates.
    p = p.withMetadata({
      exif: {
        IFD0: { Make: 'Apple', Model: 'iPhone 15 Pro' },
        // The reason this matters: a photo of a shopfront taken at a home-based
        // business carries the owner's home address, and publishing it would be us
        // doing that to them.
        GPS: { GPSLatitudeRef: 'S', GPSLatitude: '34/1 55/1 0/1', GPSLongitudeRef: 'E' },
      } as never,
    })
  return p.jpeg().toBuffer()
}

describe('format sniffing', () => {
  it('identifies real images by their bytes', async () => {
    expect(sniffFormat(await jpeg())).toBe('jpeg')
    expect(sniffFormat(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer())).toBe('png')
    expect(sniffFormat(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).webp().toBuffer())).toBe('webp')
  })

  /** Content-Type and the filename are both attacker-controlled; the bytes are not. */
  it('is not fooled by a file claiming to be an image', () => {
    expect(sniffFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull()
    expect(sniffFormat(Buffer.from('<!DOCTYPE html><html><body>hello</body></html>'))).toBeNull()
    expect(sniffFormat(Buffer.from('%PDF-1.7 ...'))).toBeNull()
  })
})

describe('processUpload', () => {
  /**
   * The security reason uploads go through us rather than straight to R2 by presigned
   * URL: a presigned PUT stores exactly what the browser sent, GPS and all.
   */
  it('strips EXIF, including GPS', async () => {
    const withGps = await jpeg(800, 600, true)
    expect(await hasExif(withGps)).toBe(true)

    const out = await processUpload(withGps)
    expect(await hasExif(out.body)).toBe(false)
    expect(out.body.toString('latin1')).not.toContain('iPhone')
  })

  it('re-encodes to webp rather than passing bytes through', async () => {
    const out = await processUpload(await jpeg())
    expect(out.contentType).toBe('image/webp')
    expect(sniffFormat(out.body)).toBe('webp')
  })

  it('caps dimensions so one photo is not every visitor’s problem', async () => {
    const out = await processUpload(await jpeg(6000, 4000))
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(2400)
  })

  it('leaves an already-small image alone rather than upscaling', async () => {
    const out = await processUpload(await jpeg(400, 300))
    expect(out.width).toBe(400)
    expect(out.height).toBe(300)
  })

  it('produces an inline blur placeholder', async () => {
    const out = await processUpload(await jpeg())
    expect(out.blurDataUrl.startsWith('data:image/webp;base64,')).toBe(true)
    // Inlined into the HTML, so it has to stay tiny.
    expect(out.blurDataUrl.length).toBeLessThan(2000)
  })

  it('rejects SVG outright', async () => {
    await expect(processUpload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).rejects.toThrow(
      UnsupportedImage,
    )
  })

  it('rejects a file over 10 MB with a message the owner can act on', async () => {
    await expect(processUpload(Buffer.alloc(11 * 1024 * 1024, 1))).rejects.toThrow(/10 MB/)
  })

  it('rejects a polyglot that starts as HTML', async () => {
    const poly = Buffer.concat([Buffer.from('<html><script>alert(1)</script>'), await jpeg()])
    await expect(processUpload(poly)).rejects.toThrow(UnsupportedImage)
  })

  it('rejects truncated bytes rather than storing them', async () => {
    await expect(processUpload((await jpeg()).subarray(0, 200))).rejects.toThrow()
  })
})

describe('asset keys', () => {
  it('are content-addressed, so the same image deduplicates', async () => {
    const img = await jpeg()
    expect(assetKey('site-1', img, 'webp')).toBe(assetKey('site-1', img, 'webp'))
  })

  it('differ per site, so keys are not guessable across tenants', async () => {
    const img = await jpeg()
    expect(assetKey('site-1', img, 'webp')).not.toBe(assetKey('site-2', img, 'webp'))
  })
})

describe('spam scoring', () => {
  it('lets a normal enquiry through', () => {
    const r = scoreSubmission(
      { name: 'Marie', phone: '0412 345 678', message: 'Kitchen sink is backing up, can you come Thursday?' },
      null,
    )
    expect(r.ok).toBe(true)
  })

  it('catches a filled honeypot immediately', () => {
    const r = scoreSubmission({ name: 'Bot' }, 'http://spam.example')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('honeypot')
  })

  it('catches link-stuffed SEO spam', () => {
    const r = scoreSubmission(
      { message: 'Cheap SEO services and backlinks! https://a.example https://b.example https://c.example' },
      null,
    )
    expect(r.ok).toBe(false)
  })

  /**
   * A tradie quoting a job will paste a link to a product page. One link must not be
   * enough on its own — a false positive silently eats a real customer's enquiry.
   */
  it('does not flag a genuine enquiry that contains one link', () => {
    const r = scoreSubmission(
      { message: 'Need this model installed: https://example.com/hot-water-systems/rheem-250 — can you quote?' },
      null,
    )
    expect(r.ok).toBe(true)
  })
})

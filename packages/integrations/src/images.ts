import sharp from 'sharp'

/**
 * P-07 -- image ingestion.
 *
 * Every upload is decoded and re-encoded rather than stored as received. That is the
 * whole point of routing uploads through us instead of handing the browser a presigned
 * URL straight to R2: a presigned PUT is faster and cheaper and cannot do any of this.
 *
 *   - Strips EXIF. A phone photo of a shopfront carries GPS coordinates, and for a
 *     home-based sole trader that is their home address, published.
 *   - Neutralises polyglots — a file that is a valid JPEG and a valid HTML document.
 *   - Caps dimensions, so a 50-megapixel photo does not become every visitor's problem.
 */

const MAX_BYTES = 10 * 1024 * 1024
const MAX_DIMENSION = 2400

/** Sniffed from the bytes. Content-Type and the file extension are both attacker-controlled. */
const MAGIC: Array<[string, (b: Buffer) => boolean]> = [
  ['jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['gif', (b) => b.subarray(0, 6).toString('latin1').startsWith('GIF8')],
  ['webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
  ['avif', (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && b.subarray(8, 12).toString('latin1').includes('avi')],
]

export class UnsupportedImage extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedImage'
  }
}

export function sniffFormat(body: Buffer): string | null {
  if (body.byteLength < 12) return null
  for (const [name, test] of MAGIC) if (test(body)) return name
  return null
}

export interface ProcessedImage {
  body: Buffer
  contentType: string
  ext: string
  width: number
  height: number
  /** A tiny blurred placeholder, inlined so a slow image does not leave a white hole. */
  blurDataUrl: string
}

export async function processUpload(
  input: Buffer,
  opts: { maxDimension?: number; square?: boolean } = {},
): Promise<ProcessedImage> {
  if (input.byteLength > MAX_BYTES)
    throw new UnsupportedImage(`That image is ${(input.byteLength / 1e6).toFixed(1)} MB. The limit is 10 MB.`)

  const format = sniffFormat(input)
  // SVG is rejected outright: it is a document format that can carry script, and no
  // amount of sanitising makes it worth the risk for a logo upload.
  if (!format)
    throw new UnsupportedImage('That file is not an image we can use. Try a JPEG, PNG or WebP.')

  const max = opts.maxDimension ?? MAX_DIMENSION
  let pipeline = sharp(input, { failOn: 'error' }).rotate() // honour EXIF orientation, then drop it

  const meta = await pipeline.metadata()
  if (!meta.width || !meta.height) throw new UnsupportedImage('That image appears to be corrupt.')

  if (meta.width > max || meta.height > max)
    pipeline = pipeline.resize(max, max, { fit: opts.square ? 'cover' : 'inside', withoutEnlargement: true })

  // webp at q82 is a good default for photographs of vans and shopfronts: visually
  // indistinguishable at the sizes we render, roughly a third the bytes of JPEG.
  const body = await pipeline.webp({ quality: 82 }).toBuffer()
  const out = await sharp(body).metadata()

  const blur = await sharp(body).resize(16, 16, { fit: 'inside' }).webp({ quality: 40 }).toBuffer()

  return {
    body,
    contentType: 'image/webp',
    ext: 'webp',
    width: out.width ?? 0,
    height: out.height ?? 0,
    blurDataUrl: `data:image/webp;base64,${blur.toString('base64')}`,
  }
}

/** True when the processed output still carries location or camera metadata. */
export async function hasExif(body: Buffer): Promise<boolean> {
  const m = await sharp(body).metadata()
  return Boolean(m.exif || m.xmp || m.iptc)
}

/**
 * C-06 -- ingest the stock pool.
 *
 *   pnpm stock:ingest            # fetch anything missing
 *   pnpm stock:ingest -- --force # re-process everything
 *
 * Every image goes through the same sharp pipeline as a customer upload: re-encoded,
 * EXIF stripped, dimensions capped. Stock photographs carry camera metadata and
 * sometimes location too, and there is no reason to serve either.
 */
import { rawPrisma } from '@awning/db'
import { STOCK_MANIFEST, type StockEntry } from '@awning/spec'
import { processUpload } from '@awning/integrations/images'
import { storage } from '@awning/integrations/storage'
import sharp from 'sharp'

const force = process.argv.includes('--force')

/** Procedural textures: a gradient plus fine grain. Never a fake photograph. */
async function generateTexture(id: string): Promise<Buffer> {
  const palettes: Record<string, [string, string]> = {
    'texture-warm-grain': ['#F6F0E8', '#E4D6C3'],
    'texture-cool-grain': ['#F2F4F7', '#D7DEE6'],
    'texture-deep-grain': ['#1A1D21', '#0E1013'],
  }
  const [from, to] = palettes[id] ?? ['#F2F2EF', '#DEDEDA']
  const w = 1600
  const h = 900

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
      </linearGradient>
      <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3"/>
        <feColorMatrix type="saturate" values="0"/></filter>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <rect width="${w}" height="${h}" filter="url(#n)" opacity="0.045"/>
  </svg>`

  return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer()
}

async function bytesFor(entry: StockEntry): Promise<Buffer> {
  if (entry.licence === 'generated') return generateTexture(entry.id)
  if (!entry.fetchUrl) throw new Error(`${entry.id}: no fetchUrl`)

  const res = await fetch(entry.fetchUrl, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${entry.id}: HTTP ${res.status} from ${entry.fetchUrl}`)
  return Buffer.from(await res.arrayBuffer())
}

async function main() {
  const store = storage()
  console.log(`Ingesting ${STOCK_MANIFEST.entries.length} entries into ${store.kind} storage\n`)

  let added = 0
  let skipped = 0
  const failed: string[] = []

  for (const entry of STOCK_MANIFEST.entries) {
    const existing = await rawPrisma.stock_assets.findUnique({ where: { id: entry.id } })
    if (existing && !force) {
      skipped++
      continue
    }

    try {
      const processed = await processUpload(await bytesFor(entry), { maxDimension: 2000 })
      const key = `stock/${entry.id}.${processed.ext}`
      const stored = await store.put(key, processed.body, processed.contentType)

      await rawPrisma.stock_assets.upsert({
        where: { id: entry.id },
        create: {
          id: entry.id,
          description: entry.description,
          industries: entry.industries,
          tags: entry.tags,
          kind: entry.kind,
          licence: entry.licence,
          credit: entry.credit,
          source_url: entry.sourceUrl,
          storage_key: stored.key,
          public_url: stored.url,
          width: processed.width,
          height: processed.height,
          bytes: stored.bytes,
          blur_data_url: processed.blurDataUrl,
        },
        update: {
          description: entry.description,
          industries: entry.industries,
          tags: entry.tags,
          credit: entry.credit,
          source_url: entry.sourceUrl,
          storage_key: stored.key,
          public_url: stored.url,
          width: processed.width,
          height: processed.height,
          bytes: stored.bytes,
          blur_data_url: processed.blurDataUrl,
        },
      })
      console.log(`  + ${entry.id.padEnd(28)} ${processed.width}x${processed.height}  ${(stored.bytes / 1024).toFixed(0)}KB`)
      added++
    } catch (e) {
      // One bad URL must not abandon the rest of the pool.
      failed.push(`${entry.id}: ${(e as Error).message}`)
    }
  }

  console.log(`\n${added} ingested, ${skipped} already present, ${failed.length} failed`)
  for (const f of failed) console.error(`  ! ${f}`)
  await rawPrisma.$disconnect()
  if (failed.length) process.exit(1)
}

void main()

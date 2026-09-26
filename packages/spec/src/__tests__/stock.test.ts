import { describe, expect, it } from 'vitest'
import {
  poolForPrompt,
  selectPool,
  stockIdOf,
  unknownStockIds,
  validateManifest,
  type StockManifest,
} from '../stock.js'
import { STOCK_MANIFEST } from '../stock-manifest.js'

/**
 * C-06. The manifest is curation data, edited by hand, and a mistake in it reaches a
 * customer's site as either a missing image or an uncredited photograph. Both of those
 * fail here instead.
 */
const entry = (over: Partial<StockManifest['entries'][number]> = {}) => ({
  id: 'butcher-counter-01',
  industries: ['butcher'],
  description: 'A butcher trimming meat behind a glass display counter',
  tags: [],
  kind: 'photo' as const,
  licence: 'unsplash' as const,
  credit: 'Jane Doe on Unsplash',
  sourceUrl: 'https://unsplash.com/photos/abc123',
  fetchUrl: 'https://images.unsplash.com/photo-abc123',
  ...over,
})
const manifest = (entries: unknown[]) => ({ version: 1, entries })

describe('manifest validation', () => {
  it('accepts a well-formed entry', () => {
    expect(validateManifest(manifest([entry()])).ok).toBe(true)
  })

  it('rejects a duplicate id', () => {
    const r = validateManifest(manifest([entry(), entry({ description: 'A different photo entirely' })]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toMatch(/duplicate/)
  })

  // Getting attribution wrong is the same class of mistake as inventing a testimonial.
  it('rejects an unsplash entry with no credit', () => {
    const r = validateManifest(manifest([entry({ credit: null })]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toMatch(/no credit/)
  })

  it('rejects an unsplash entry with no source URL', () => {
    expect(validateManifest(manifest([entry({ sourceUrl: null })])).ok).toBe(false)
  })

  it('does not require credit for work we own', () => {
    const r = validateManifest(manifest([entry({ licence: 'owned', credit: null, sourceUrl: null })]))
    expect(r.ok).toBe(true)
  })

  it('refuses to let a generated image claim to be a photograph', () => {
    const r = validateManifest(
      manifest([entry({ licence: 'generated', kind: 'photo', credit: null, sourceUrl: null, fetchUrl: null })]),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toMatch(/do not pass generated images off as photographs/)
  })

  it('rejects an entry ingest could never fetch', () => {
    const r = validateManifest(manifest([entry({ fetchUrl: null })]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toMatch(/fetchUrl/)
  })

  it('rejects a description too short to serve as alt text', () => {
    expect(validateManifest(manifest([entry({ description: 'meat' })])).ok).toBe(false)
  })

  it('the manifest we actually ship is valid', () => {
    expect(validateManifest(STOCK_MANIFEST).ok).toBe(true)
  })
})

describe('pool selection', () => {
  const pool: StockManifest = {
    version: 1,
    entries: [
      entry({ id: 'butcher-a', industries: ['butcher'] }),
      entry({ id: 'butcher-b', industries: ['butcher'] }),
      entry({ id: 'plumber-a', industries: ['plumber'] }),
      entry({ id: 'general-a', industries: [] }),
      entry({ id: 'texture-a', industries: [], kind: 'texture' }),
    ] as StockManifest['entries'],
  }

  it('puts the industry first and keeps the general images', () => {
    const ids = selectPool(pool, { industry: 'butcher' }).map((e) => e.id)
    expect(ids.slice(0, 2)).toEqual(['butcher-a', 'butcher-b'])
    expect(ids).toContain('general-a')
  })

  it('excludes other industries entirely', () => {
    expect(selectPool(pool, { industry: 'butcher' }).map((e) => e.id)).not.toContain('plumber-a')
  })

  // Every entry costs tokens in the cached prefix, so the cap has to hold.
  it('honours the limit', () => {
    expect(selectPool(pool, { industry: 'butcher', limit: 2 })).toHaveLength(2)
  })

  it('an unknown industry still offers the general images', () => {
    expect(selectPool(pool, { industry: 'astrologer' }).map((e) => e.id)).toEqual(['general-a', 'texture-a'])
  })

  it('shows the model an id and a description and nothing else', () => {
    const shown = poolForPrompt(selectPool(pool, { industry: 'plumber', limit: 1 }))
    expect(shown).toEqual([{ assetId: 'stock:plumber-a', description: entry().description }])
  })
})

describe('reference checking', () => {
  const known: StockManifest = { version: 1, entries: [entry({ id: 'butcher-a' })] as StockManifest['entries'] }

  it('reads the id back off a reference', () => {
    expect(stockIdOf('stock:butcher-a')).toBe('butcher-a')
    expect(stockIdOf('asset_ab12cd34')).toBeNull()
  })

  it('finds an invented id nested anywhere in a spec', () => {
    const spec = { pages: [{ sections: [{ props: { image: { assetId: 'stock:butcher-hero-sunset' } } }] }] }
    expect(unknownStockIds(spec, known)).toEqual(['stock:butcher-hero-sunset'])
  })

  it('passes a real id and ignores uploads', () => {
    const spec = { a: 'stock:butcher-a', b: 'asset_ab12cd34', c: 'stock notes: not an id' }
    expect(unknownStockIds(spec, known)).toEqual([])
  })

  it('reports each bad id once however often it appears', () => {
    const spec = ['stock:nope', { x: 'stock:nope' }]
    expect(unknownStockIds(spec, known)).toEqual(['stock:nope'])
  })
})

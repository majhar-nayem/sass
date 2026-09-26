import { describe, expect, it } from 'vitest'
import { mapHeaders, parseCsv, parseMoneyCents, parseProductCsv } from '../products/csv.js'

/**
 * M-04. The acceptance criterion is forty products out of a spreadsheet in one go, and
 * the spreadsheet was not written for us — it came out of Excel or MYOB with whatever
 * headers the owner typed.
 */
describe('the CSV parser', () => {
  it('handles quoted fields containing commas', () => {
    expect(parseCsv('a,b\n"Beef, diced",12')).toEqual([['a', 'b'], ['Beef, diced', '12']])
  })

  it('handles escaped quotes', () => {
    expect(parseCsv('a\n"He said ""hello"""')).toEqual([['a'], ['He said "hello"']])
  })

  // Product descriptions routinely contain newlines.
  it('handles a newline inside a quoted field', () => {
    expect(parseCsv('a,b\n"line one\nline two",2')).toEqual([['a', 'b'], ['line one\nline two', '2']])
  })

  it('handles CRLF, which is what Excel writes', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  // Excel prepends a BOM; without stripping it the first header becomes "\uFEFFTitle"
  // and the product name column silently disappears. Written as an escape rather than
  // a literal character so it survives editing and does not read as stray whitespace.
  it('strips the UTF-8 BOM Excel adds', () => {
    const withBom = '\uFEFF' + 'Title,Price\nHam,10'
    expect(withBom.charCodeAt(0)).toBe(0xfeff)
    // Asserted on the parser's own output, not through mapHeaders: header matching
    // strips non-alphanumerics anyway, so it absorbs a BOM by accident and can never
    // tell whether the parser handled one.
    expect(parseCsv(withBom)[0]![0]).toBe('Title')
  })

  // Blank rows are kept by the parser on purpose: dropping them here would shift every
  // row number after a gap, and the numbers are how an owner finds the row in Excel.
  it('keeps blank rows so numbering stays true', () => {
    expect(parseCsv('a,b\n1,2\n,\n3,4')).toHaveLength(4)
  })

  it('keeps a final row with no trailing newline', () => {
    expect(parseCsv('a\n1')).toEqual([['a'], ['1']])
  })
})

describe('header matching', () => {
  it('accepts the names people actually use', () => {
    for (const h of ['Title', 'Name', 'Product', 'PRODUCT NAME', 'item'])
      expect(mapHeaders([h]).index.title).toBe(0)
    for (const h of ['Price', 'Price (inc GST)', 'Sell Price', 'RETAIL PRICE'])
      expect(mapHeaders([h]).index.price).toBe(0)
  })

  it('reports columns it did not understand rather than ignoring them silently', () => {
    expect(mapHeaders(['Title', 'Price', 'Supplier Ref']).ignored).toEqual(['Supplier Ref'])
  })

  // A sheet with both "Price" and "Retail Price" must not have the second quietly win.
  it('takes the first match when two columns mean the same thing', () => {
    expect(mapHeaders(['Price', 'Retail Price']).index.price).toBe(0)
  })
})

describe('reading money', () => {
  it('reads the shapes a price is written in', () => {
    expect(parseMoneyCents('12.50')).toBe(1250)
    expect(parseMoneyCents('$12.50')).toBe(1250)
    expect(parseMoneyCents(' 12.5 ')).toBe(1250)
    expect(parseMoneyCents('1,250.00')).toBe(125000)
    expect(parseMoneyCents('8')).toBe(800)
  })

  it('refuses what is not a price, instead of guessing', () => {
    for (const s of ['twelve', '', 'POA', '12.345', '-5']) expect(parseMoneyCents(s)).toBeNull()
  })
})

const sheet = (rows: string) => parseProductCsv(rows)

describe('importing a real-looking sheet', () => {
  const csv = [
    'Product,SKU,Price,Category,Stock,GST Free',
    'Christmas Ham (half),HAM-H,68.00,Christmas,12,yes',
    '"Beef, diced",BEEF-D,22.50,Butchery,40,yes',
    'Marinated chicken skewers,CHK-SK,14.00,Butchery,25,no',
  ].join('\n')

  it('reads every row', () => {
    const r = sheet(csv)
    expect(r.products).toHaveLength(3)
    expect(r.problems).toEqual([])
  })

  it('keeps prices in cents', () => {
    expect(sheet(csv).products[0]!.priceCents).toBe(6800)
  })

  // Fresh meat is GST-free; cooked or marinated is not. A butcher's Christmas
  // catalogue contains both, which is exactly why this is per product.
  it('carries GST-free through per product', () => {
    const r = sheet(csv)
    expect(r.products[1]!.gstFree).toBe(true)
    expect(r.products[2]!.gstFree).toBe(false)
  })

  // Forty products appearing live the moment a file is dropped is not a recoverable
  // surprise.
  it('imports as drafts unless the sheet says otherwise', () => {
    expect(sheet(csv).products.every((p) => p.status === 'draft')).toBe(true)
    expect(sheet('Title,Price,Status\nHam,10,active').products[0]!.status).toBe('active')
  })
})

describe('a sheet with problems in it', () => {
  // The whole point: row 23 being wrong must not cost the other thirty-nine.
  it('reports the bad row and keeps the good ones', () => {
    const r = sheet('Title,Price\nHam,68.00\nBroken,POA\nTurkey,45.00')
    expect(r.products.map((p) => p.title)).toEqual(['Ham', 'Turkey'])
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toMatchObject({ row: 3, column: 'price' })
  })

  it('numbers rows the way Excel does, so they can be found', () => {
    const r = sheet('Title,Price\nHam,10\n,20')
    expect(r.problems[0]!.row).toBe(3)
  })

  /**
   * The one the end-to-end run caught. A spacer row before the Christmas section is
   * completely normal, and numbering past it sent the owner to the wrong line.
   */
  it('keeps row numbers true when the sheet has blank rows in the middle', () => {
    const r = sheet('Title,Price\nHam,68\n,\nMystery,POA\nTurkey,45')
    expect(r.products.map((p) => p.title)).toEqual(['Ham', 'Turkey'])
    expect(r.problems).toHaveLength(1)
    // Ham=2, blank=3, Mystery=4 — exactly what Excel shows in the row gutter.
    expect(r.problems[0]!.row).toBe(4)
  })

  it('does not complain about a blank spacer row', () => {
    expect(sheet('Title,Price\nHam,68\n,\n\nTurkey,45').problems).toEqual([])
  })

  it('still treats a genuinely empty file as empty', () => {
    expect(sheet('\n\n,\n').problems[0]!.message).toMatch(/empty/i)
  })

  it('refuses a file with no name column, and says which column is missing', () => {
    const r = sheet('Thing,Cost\nHam,10')
    expect(r.products).toEqual([])
    expect(r.problems.map((p) => p.message).join()).toMatch(/product name column/i)
  })

  it('refuses a file with no price column', () => {
    expect(sheet('Title\nHam').problems.map((p) => p.message).join()).toMatch(/price column/i)
  })

  it('skips a duplicated SKU rather than letting the second overwrite the first', () => {
    const r = sheet('Title,SKU,Price\nHam,H1,10\nOther Ham,H1,12')
    expect(r.products).toHaveLength(1)
    expect(r.problems[0]!.message).toMatch(/also on row 2/)
  })

  it('handles an empty file without throwing', () => {
    expect(sheet('').problems[0]!.message).toMatch(/empty/i)
  })
})

/**
 * Australian Consumer Law. A struck-out "was" price that was never the actual selling
 * price is misleading conduct — the same thing the spec validator refuses to let the
 * AI generate, and the same thing our acceptable use policy tells customers not to do.
 */
describe('was-prices', () => {
  it('reads a genuine one', () => {
    expect(sheet('Title,Price,Was Price\nHam,68,85').products[0]!.compareAtCents).toBe(8500)
  })

  it('drops a was-price that is not higher than the price, and says why', () => {
    const r = sheet('Title,Price,RRP\nHam,68,68')
    expect(r.products[0]!.compareAtCents).toBeNull()
    expect(r.problems[0]!.message).toMatch(/not higher than the price/)
  })

  it('drops a was-price below the selling price', () => {
    expect(sheet('Title,Price,RRP\nHam,68,50').products[0]!.compareAtCents).toBeNull()
  })

  it('still imports the product when the was-price is unreadable', () => {
    const r = sheet('Title,Price,Was\nHam,68,n/a')
    expect(r.products).toHaveLength(1)
    expect(r.products[0]!.compareAtCents).toBeNull()
  })
})

describe('ambiguous columns', () => {
  // "GST" could mean "GST applies" or "GST free". Read it the safe way round —
  // charging GST where it is due is recoverable, failing to charge it is not.
  it('charges GST when the GST column cannot be read, and says so', () => {
    const r = sheet('Title,Price,GST\nHam,68,maybe')
    expect(r.products[0]!.gstFree).toBe(false)
    expect(r.problems[0]!.message).toMatch(/GST will be charged/)
  })

  it('turns off stock tracking rather than guessing a quantity', () => {
    const r = sheet('Title,Price,Stock\nHam,68,lots')
    expect(r.products[0]!.trackInventory).toBe(false)
    expect(r.products[0]!.inventoryQty).toBe(0)
  })

  it('tracks stock when the number is a number', () => {
    const p = sheet('Title,Price,Qty\nHam,68,12').products[0]!
    expect(p.trackInventory).toBe(true)
    expect(p.inventoryQty).toBe(12)
  })
})

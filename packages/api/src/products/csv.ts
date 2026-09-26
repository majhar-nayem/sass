/**
 * M-04 -- reading a spreadsheet a butcher actually has.
 *
 * The acceptance criterion is "40 products imported from a spreadsheet in one go", and
 * the spreadsheet in question was not written for us. It came out of Excel or MYOB, the
 * headers say whatever the owner typed, prices have dollar signs in them, and row 23 is
 * blank because they left a gap before the Christmas hams.
 *
 * So: no dependency, a real RFC 4180 parser (quoted commas and embedded newlines are
 * routine in product descriptions), forgiving header matching, and per-row errors that
 * name the row. An import that fails wholesale on row 23 of 40 is an import nobody
 * completes.
 */

export interface ParsedProduct {
  /** 1-based, counting the header, so it matches what the owner sees in Excel. */
  row: number
  title: string
  sku: string | null
  priceCents: number
  compareAtCents: number | null
  description: string | null
  category: string | null
  gstFree: boolean
  trackInventory: boolean
  inventoryQty: number
  status: 'draft' | 'active'
}

export interface RowProblem {
  row: number
  column: string | null
  message: string
}

export interface ParseResult {
  products: ParsedProduct[]
  problems: RowProblem[]
  /** Headers we did not recognise, so the owner can see what was ignored. */
  ignoredColumns: string[]
  /** True when a "was price" column was present — see compareAt handling below. */
  sawCompareAt: boolean
}

// ------------------------------------------------------------------ the parser

/**
 * RFC 4180. Handles quoted fields containing commas, quotes and newlines, CRLF, and a
 * UTF-8 BOM — which Excel adds and which otherwise turns the first header into
 * "Title" and quietly loses the product name column.
 */
export function parseCsv(input: string): string[][] {
  // Written as an escape, not a literal BOM character: a literal one is invisible,
  // reads as stray whitespace to tooling, and gets deleted by anything tidying the file.
  const text = input.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < text.length) {
    const c = text[i]!
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"' // an escaped quote
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      endField()
      i++
      continue
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') i++
      endRow()
      i++
      continue
    }
    if (c === '\n') {
      endRow()
      i++
      continue
    }
    field += c
    i++
  }
  // A file not ending in a newline still has a last row.
  if (field !== '' || row.length > 0) endRow()

  // Blank rows are NOT dropped here. Row numbers are the only way an owner finds the
  // problem row in their own spreadsheet, and dropping blanks before numbering shifts
  // every row after a gap — which sends them to the wrong line and is worse than
  // giving no number at all.
  return rows
}

/** A row where every cell is empty: a spacer, not a product. */
export const isBlankRow = (r: string[]): boolean => r.every((c) => c.trim() === '')

// ----------------------------------------------------------------- the headers

/**
 * What a column might be called.
 *
 * Nobody is going to rename their columns to match our documentation, and telling them
 * to is how an import becomes a support call.
 */
const COLUMNS: Record<string, string[]> = {
  title: ['title', 'name', 'product', 'productname', 'item', 'description short'],
  sku: ['sku', 'code', 'itemcode', 'productcode', 'barcode'],
  price: ['price', 'priceinc', 'priceincgst', 'sellprice', 'sellingprice', 'retail', 'retailprice', 'amount'],
  compareAt: ['wasprice', 'was', 'rrp', 'comparaeat', 'compareat', 'compareatprice', 'originalprice', 'normalprice'],
  description: ['description', 'details', 'longdescription', 'notes', 'blurb'],
  category: ['category', 'group', 'department', 'type', 'section'],
  gstFree: ['gstfree', 'nogst', 'gstexempt', 'freeofgst', 'gst'],
  inventory: ['stock', 'qty', 'quantity', 'inventory', 'stockonhand', 'soh', 'available'],
  status: ['status', 'active', 'published', 'live'],
}

const normalise = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

export function mapHeaders(headers: string[]): {
  index: Partial<Record<keyof typeof COLUMNS, number>>
  ignored: string[]
} {
  const index: Partial<Record<string, number>> = {}
  const ignored: string[] = []

  headers.forEach((raw, i) => {
    const n = normalise(raw)
    if (!n) return
    const field = Object.keys(COLUMNS).find((f) => COLUMNS[f]!.includes(n))
    // First match wins: a sheet with both "Price" and "Retail Price" should not have
    // the second silently replace the first.
    if (field && index[field] === undefined) index[field] = i
    else if (!field) ignored.push(raw.trim())
  })

  return { index: index as Partial<Record<keyof typeof COLUMNS, number>>, ignored }
}

// ------------------------------------------------------------------- the values

/**
 * "$12.50", "12,50", "1,250.00", "12.5 " all mean money. "twelve fifty" does not.
 *
 * Returns cents, because floating point and money do not belong in the same sentence.
 */
export function parseMoneyCents(raw: string): number | null {
  const s = raw.trim().replace(/[$\s]/g, '')
  if (!s) return null
  // Thousands separators, but only where they are actually separating thousands.
  const cleaned = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  return Math.round(Number(cleaned) * 100)
}

const TRUE_WORDS = new Set(['y', 'yes', 'true', '1', 'x', 't', 'active', 'live', 'published'])
const FALSE_WORDS = new Set(['n', 'no', 'false', '0', '', 'f', 'draft', 'inactive', 'hidden'])

export function parseBool(raw: string): boolean | null {
  const s = raw.trim().toLowerCase()
  if (TRUE_WORDS.has(s)) return true
  if (FALSE_WORDS.has(s)) return false
  return null
}

// ------------------------------------------------------------------- the import

export function parseProductCsv(text: string): ParseResult {
  const rows = parseCsv(text)
  const problems: RowProblem[] = []
  if (rows.every(isBlankRow))
    return { products: [], problems: [{ row: 0, column: null, message: 'The file is empty.' }], ignoredColumns: [], sawCompareAt: false }

  const { index, ignored } = mapHeaders(rows[0]!)
  if (index.title === undefined)
    problems.push({
      row: 1,
      column: null,
      message: 'No product name column. One column needs to be called Title, Name or Product.',
    })
  if (index.price === undefined)
    problems.push({ row: 1, column: null, message: 'No price column. One column needs to be called Price.' })

  if (problems.length)
    return { products: [], problems, ignoredColumns: ignored, sawCompareAt: index.compareAt !== undefined }

  const at = (r: string[], k: keyof typeof COLUMNS): string =>
    index[k] === undefined ? '' : (r[index[k]!] ?? '')

  const products: ParsedProduct[] = []
  const seenSku = new Map<string, number>()

  rows.slice(1).forEach((r, n) => {
    const row = n + 2 // header is row 1, so the numbers match what Excel shows
    // A spacer row is not a mistake and does not earn a complaint — but it still
    // occupies its row number, so everything below it stays findable.
    if (isBlankRow(r)) return

    const title = at(r, 'title').trim()
    if (!title) {
      problems.push({ row, column: 'title', message: 'No product name, so this row was skipped.' })
      return
    }

    const priceRaw = at(r, 'price')
    const priceCents = parseMoneyCents(priceRaw)
    if (priceCents === null) {
      problems.push({
        row,
        column: 'price',
        message: priceRaw.trim()
          ? `"${priceRaw.trim()}" is not a price we can read.`
          : 'No price.',
      })
      return
    }

    const sku = at(r, 'sku').trim() || null
    if (sku) {
      const first = seenSku.get(sku.toLowerCase())
      if (first !== undefined) {
        // Two rows claiming the same SKU is a mistake in the sheet, and importing both
        // would mean the second silently overwrites the first.
        problems.push({ row, column: 'sku', message: `SKU "${sku}" is also on row ${first}. This row was skipped.` })
        return
      }
      seenSku.set(sku.toLowerCase(), row)
    }

    const compareRaw = at(r, 'compareAt')
    let compareAtCents: number | null = null
    if (compareRaw.trim()) {
      const c = parseMoneyCents(compareRaw)
      if (c === null)
        problems.push({ row, column: 'compareAt', message: `"${compareRaw.trim()}" is not a price we can read; the was-price was left off.` })
      else if (c <= priceCents)
        // A "was" price at or below the selling price is not a saving, and showing it
        // as one is misleading conduct under the Australian Consumer Law.
        problems.push({
          row,
          column: 'compareAt',
          message: `The was-price (${fmt(c)}) is not higher than the price (${fmt(priceCents)}), so it was left off.`,
        })
      else compareAtCents = c
    }

    const gstRaw = at(r, 'gstFree')
    let gstFree = false
    if (gstRaw.trim()) {
      const b = parseBool(gstRaw)
      // A column called "GST" is ambiguous: it may mean "GST applies" or "GST free".
      // Read it the safe way round — charging GST where it is due is recoverable,
      // failing to is not — and say so.
      if (b === null)
        problems.push({ row, column: 'gstFree', message: `"${gstRaw.trim()}" is not a yes or no; GST will be charged on this item.` })
      else gstFree = b
    }

    const qtyRaw = at(r, 'inventory').trim()
    let inventoryQty = 0
    let trackInventory = false
    if (qtyRaw) {
      const q = Number(qtyRaw.replace(/,/g, ''))
      if (!Number.isFinite(q) || q < 0 || !Number.isInteger(q))
        problems.push({ row, column: 'inventory', message: `"${qtyRaw}" is not a stock number; stock tracking is off for this item.` })
      else {
        inventoryQty = q
        trackInventory = true
      }
    }

    const statusRaw = at(r, 'status').trim()
    const statusBool = statusRaw ? parseBool(statusRaw) : null
    products.push({
      row,
      title,
      sku,
      priceCents,
      compareAtCents,
      description: at(r, 'description').trim() || null,
      category: at(r, 'category').trim() || null,
      gstFree,
      trackInventory,
      inventoryQty,
      // Imported as drafts unless the sheet says otherwise. Forty products appearing
      // live on a website the moment a file is dropped is not a recoverable surprise.
      status: statusBool === true ? 'active' : 'draft',
    })
  })

  return { products, problems, ignoredColumns: ignored, sawCompareAt: index.compareAt !== undefined }
}

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`

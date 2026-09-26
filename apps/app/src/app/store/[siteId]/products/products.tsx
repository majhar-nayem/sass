'use client'
import { useState } from 'react'
import { trpc, TrpcError } from '@/lib/trpc-client'

/**
 * M-04 -- the catalogue, and getting a spreadsheet into it.
 *
 * The owner has forty products in a file and no intention of typing them in. So the
 * import is the primary action on this screen, it shows exactly what will happen
 * before it happens, and it names the rows it could not read by the numbers Excel uses.
 */
interface Product {
  id: string
  title: string
  sku: string | null
  priceCents: number
  compareAtCents: number | null
  gstFree: boolean
  status: string
  category: string | null
  inventoryQty: number | null
}

interface Preview {
  willCreate: number
  categories: string[]
  needsCompareAtAttestation: boolean
  ignoredColumns: string[]
  problems: Array<{ row: number; column: string | null; message: string }>
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`

export function Products({
  siteId,
  siteName,
  initial,
}: {
  siteId: string
  siteName: string
  initial: Product[]
}) {
  const [products, setProducts] = useState(initial)
  const [csv, setCsv] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [attested, setAttested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function onFile(file: File) {
    setError(null)
    setDone(null)
    setAttested(false)
    const text = await file.text()
    setCsv(text)
    setFileName(file.name)
    setBusy(true)
    try {
      setPreview(await trpc.mutate<Preview>('product.previewImport', { siteId, csv: text }))
    } catch (e) {
      setPreview(null)
      setError(e instanceof TrpcError ? e.message : 'Could not read that file.')
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    if (!csv) return
    setBusy(true)
    setError(null)
    try {
      const s = await trpc.mutate<{ created: number; updated: number; skipped: number; compareAtDropped: number }>(
        'product.import',
        { siteId, csv, compareAtAttested: attested },
      )
      setDone(
        `${s.created} added, ${s.updated} updated${s.skipped ? `, ${s.skipped} skipped` : ''}` +
          (s.compareAtDropped ? `. ${s.compareAtDropped} was-prices left off.` : '.'),
      )
      setProducts(await trpc.query<Product[]>('product.list', { siteId }))
      setCsv(null)
      setPreview(null)
      setFileName(null)
    } catch (e) {
      setError(e instanceof TrpcError ? e.message : 'The import did not finish.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-sm text-muted">{siteName}</p>
      <h1 className="mt-1 mb-8 text-2xl font-semibold">Products</h1>

      <section className="rounded-xl border border-rule p-5">
        <h2 className="font-semibold">Import from a spreadsheet</h2>
        <p className="mt-1 text-sm text-muted">
          Save your spreadsheet as CSV and drop it here. Columns called Product, Price, SKU,
          Category, Stock and GST Free are picked up automatically — the names do not have to match
          exactly.
        </p>

        <input
          type="file"
          accept=".csv,text/csv"
          className="mt-4 block text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
          }}
        />

        {preview && (
          <div className="mt-5 rounded-lg bg-surface p-4 text-sm">
            <p className="font-semibold">
              {fileName}: {preview.willCreate} product{preview.willCreate === 1 ? '' : 's'} ready to import
            </p>
            {preview.categories.length > 0 && (
              <p className="mt-1 text-muted">Categories: {preview.categories.join(', ')}</p>
            )}
            {preview.ignoredColumns.length > 0 && (
              <p className="mt-1 text-muted">
                Columns we did not use: {preview.ignoredColumns.join(', ')}
              </p>
            )}

            {preview.problems.length > 0 && (
              <div className="mt-3">
                <p className="font-semibold">
                  {preview.problems.length} row{preview.problems.length === 1 ? '' : 's'} need a look:
                </p>
                <ul className="mt-1 space-y-0.5 text-muted">
                  {preview.problems.slice(0, 12).map((p, i) => (
                    <li key={i}>
                      Row {p.row}: {p.message}
                    </li>
                  ))}
                  {preview.problems.length > 12 && <li>…and {preview.problems.length - 12} more.</li>}
                </ul>
              </div>
            )}

            {/*
              The only place this claim can be made. A struck-out "was" price that was
              never the actual selling price is misleading conduct under the Australian
              Consumer Law, and a spreadsheet cannot know whether a number was ever
              charged. Unticked, the was-prices are simply left off.
            */}
            {preview.needsCompareAtAttestation && (
              <label className="mt-4 flex items-start gap-3 border-t border-rule pt-4">
                <input
                  type="checkbox"
                  checked={attested}
                  onChange={(e) => setAttested(e.target.checked)}
                  className="mt-0.5 h-5 w-5"
                />
                <span>
                  This file has “was” prices in it. I confirm each one was the price I actually
                  charged for that item, for a reasonable period before the sale.
                  <span className="mt-1 block text-muted">
                    Leave this unticked and we will import the products without the was-prices.
                  </span>
                </span>
              </label>
            )}

            <button
              type="button"
              disabled={busy || preview.willCreate === 0}
              onClick={() => void runImport()}
              className="mt-4 min-h-11 rounded-lg bg-brand px-6 font-semibold text-white disabled:opacity-40"
            >
              Import {preview.willCreate} product{preview.willCreate === 1 ? '' : 's'}
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm font-semibold text-brand">
            {error}
          </p>
        )}
        {done && <p className="mt-4 text-sm font-semibold text-green-800">{done}</p>}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 font-semibold">
          {products.length} product{products.length === 1 ? '' : 's'}
        </h2>
        {products.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. Import a spreadsheet to get started.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-rule text-left text-muted">
              <tr>
                <th className="py-2 font-medium">Product</th>
                <th className="py-2 font-medium">Price</th>
                <th className="py-2 font-medium">GST</th>
                <th className="py-2 font-medium">Stock</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-rule/60">
                  <td className="py-2">
                    {p.title}
                    {p.category && <span className="ml-2 text-muted">{p.category}</span>}
                  </td>
                  <td className="py-2">
                    {money(p.priceCents)}
                    {p.compareAtCents && (
                      <span className="ml-2 text-muted line-through">{money(p.compareAtCents)}</span>
                    )}
                  </td>
                  <td className="py-2 text-muted">{p.gstFree ? 'GST free' : 'inc. GST'}</td>
                  <td className="py-2 text-muted">{p.inventoryQty ?? '—'}</td>
                  <td className="py-2 text-muted">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}

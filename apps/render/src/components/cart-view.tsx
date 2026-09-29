'use client'
import { useEffect, useState } from 'react'

interface Line {
  productId: string
  slug: string
  title: string
  qty: number
  unitCents: number
  lineCents: number
  cappedFrom: number | null
}
interface CartState {
  lines: Line[]
  unavailable: Array<{ productId: string; reason: string }>
  itemCount: number
  subtotalCents: number
  gstCents: number
  gstRegistered: boolean
  acceptsOrders: boolean
}

const money = (c: number) =>
  `$${(c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * The cart, fetched by the browser.
 *
 * Rendering it on the server would read the cookie during render, and then the HTML
 * for /cart would differ per visitor — one cached copy away from showing a stranger
 * someone else's Christmas order. So the page is an empty shell and this fills it.
 */
export function CartView() {
  const [cart, setCart] = useState<CartState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/cart', { cache: 'no-store' })
      .then(async (r) => (r.ok ? setCart(await r.json()) : setError('Your cart could not be loaded.')))
      .catch(() => setError('Your cart could not be loaded.'))
  }, [])

  async function change(body: Record<string, unknown>) {
    setBusy(true)
    try {
      const r = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.ok) setCart(await r.json())
      else setError((await r.json()).error ?? 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p role="alert">{error}</p>
  if (!cart) return <p aria-busy="true">Loading your cart…</p>

  return (
    <div>
      {cart.unavailable.length > 0 && (
        // Shown, not silently dropped: a ham that vanished from the basket without a
        // word reads as a bug, and it is the kind that loses the sale.
        <p className="mb-6 rounded-[var(--radius)] bg-[var(--brand-surface)] px-4 py-3 text-sm">
          {cart.unavailable.length === 1 ? 'One item is' : `${cart.unavailable.length} items are`} no longer
          available and {cart.unavailable.length === 1 ? 'was' : 'were'} taken out of your cart.
        </p>
      )}

      {cart.lines.length === 0 ? (
        <p>
          Your cart is empty.{' '}
          <a href="/shop" className="underline">
            Back to the shop
          </a>
        </p>
      ) : (
        <>
          <ul className="divide-y divide-current/10 border-y border-current/10">
            {cart.lines.map((l) => (
              <li key={l.productId} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div>
                  <a href={`/shop/${l.slug}`} className="font-semibold underline-offset-2 hover:underline">
                    {l.title}
                  </a>
                  <p className="text-sm opacity-70">{money(l.unitCents)} each</p>
                  {l.cappedFrom && (
                    <p className="text-sm font-semibold">Only {l.qty} in stock — we have adjusted your quantity.</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <label className="sr-only" htmlFor={`qty-${l.productId}`}>
                    Quantity of {l.title}
                  </label>
                  <input
                    id={`qty-${l.productId}`}
                    type="number"
                    min={0}
                    max={99}
                    defaultValue={l.qty}
                    disabled={busy}
                    onBlur={(e) => {
                      const q = Math.max(0, Math.min(99, Number(e.target.value) || 0))
                      if (q !== l.qty) void change({ action: 'set', productId: l.productId, qty: q })
                    }}
                    className="w-20 rounded-[var(--radius)] border border-current/20 bg-transparent px-3 py-2"
                  />
                  <span className="w-24 text-right font-semibold">{money(l.lineCents)}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void change({ action: 'remove', productId: l.productId })}
                    className="text-sm underline"
                  >
                    Remove<span className="sr-only"> {l.title}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 text-right">
            <p className="text-xl font-semibold">Total {money(cart.subtotalCents)}</p>
            {/* A business under the GST threshold must not show GST it does not charge. */}
            {cart.gstRegistered && cart.gstCents > 0 && (
              <p className="mt-1 text-sm opacity-70">Includes {money(cart.gstCents)} GST</p>
            )}
            <p className="mt-4 text-sm opacity-70">
              {cart.acceptsOrders
                ? 'Checkout is coming soon.'
                : 'Online ordering is not open yet — ring us to order.'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

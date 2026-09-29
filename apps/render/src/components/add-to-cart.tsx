'use client'
import { useState } from 'react'

/**
 * The one interactive thing on a product page. Everything else on the page is the same
 * for every visitor and can sit in a CDN; this posts to /api/cart and reports back.
 */
export function AddToCart({ productId, available }: { productId: string; available: boolean }) {
  const [qty, setQty] = useState(1)
  const [state, setState] = useState<'idle' | 'busy' | 'added' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  if (!available) return <p className="mt-6 font-semibold opacity-70">Sold out</p>

  async function add() {
    setState('busy')
    setMessage(null)
    try {
      const res = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'add', productId, qty }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not add that.')
      const line = body.lines.find((l: { productId: string }) => l.productId === productId)
      setState('added')
      setMessage(line?.cappedFrom ? `Only ${line.qty} left — that is how many are in your cart.` : null)
    } catch (e) {
      setState('error')
      setMessage((e as Error).message)
    }
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Quantity
          <input
            type="number"
            min={1}
            max={99}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
            className="w-20 rounded-[var(--radius)] border border-current/20 bg-transparent px-3 py-2"
          />
        </label>
        <button
          type="button"
          disabled={state === 'busy'}
          onClick={() => void add()}
          className="min-h-11 rounded-[var(--radius)] bg-[var(--brand-primary)] px-6 font-semibold text-[var(--brand-on-primary)] disabled:opacity-50"
        >
          {state === 'busy' ? 'Adding…' : 'Add to cart'}
        </button>
      </div>
      <p role="status" aria-live="polite" className="mt-3 text-sm">
        {state === 'added' && (
          <>
            Added.{' '}
            <a href="/cart" className="underline">
              View cart
            </a>
          </>
        )}
        {message && <span className="block opacity-80">{message}</span>}
      </p>
    </div>
  )
}

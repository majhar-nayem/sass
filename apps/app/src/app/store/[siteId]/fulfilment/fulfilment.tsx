'use client'
import { useState } from 'react'
import { trpc, TrpcError } from '@/lib/trpc-client'

/**
 * M-09 -- how customers get their orders.
 *
 * The acceptance criterion is a butcher setting up pickup-only in under two minutes, so
 * pickup comes first, its address is already filled in from the business address, and
 * the whole screen saves with one button. Delivery and post are below it, off, and stay
 * out of the way until wanted.
 */
interface Form {
  pickup: { enabled: boolean; address: string; instructions: string }
  delivery: { enabled: boolean; postcodes: string; feeCents: number; minCents: number | null }
  post: { enabled: boolean; name: string; priceCents: number; freeOverCents: number | null }
}
type Problem = { field: string; message: string }

const dollars = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace(/\.00$/, ''))
const cents = (v: string) => {
  const n = Number(v.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0
}
const centsOrNull = (v: string) => (v.trim() ? cents(v) : null)

export function Fulfilment({ siteId, siteName, initial }: { siteId: string; siteName: string; initial: Form }) {
  const [f, setF] = useState<Form>(initial)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<Problem[]>([])
  const [saved, setSaved] = useState(false)

  const set = <K extends keyof Form>(k: K, patch: Partial<Form[K]>) => {
    setF((prev) => ({ ...prev, [k]: { ...prev[k], ...patch } }))
    setSaved(false)
  }
  const problem = (field: string) => problems.find((p) => p.field === field)?.message

  async function save() {
    setBusy(true)
    setProblems([])
    try {
      const r = await trpc.mutate<{ ok: true } | { ok: false; problems: Problem[] }>('store.saveFulfilment', { siteId, ...f })
      if (r.ok) setSaved(true)
      else setProblems(r.problems)
    } catch (e) {
      setProblems([{ field: 'all', message: e instanceof TrpcError ? e.message : 'That did not save. Try again.' }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-[60ch] px-6 py-12">
      <p className="text-sm text-muted">{siteName}</p>
      <h1 className="mt-1 mb-2 text-2xl font-semibold">How customers get their orders</h1>
      <p className="mb-8 text-sm text-muted">Turn on at least one. You can change these any time.</p>

      <section className="rounded-xl border border-rule p-5">
        <label className="flex items-center gap-3 font-semibold">
          <input type="checkbox" className="h-5 w-5" checked={f.pickup.enabled} onChange={(e) => set('pickup', { enabled: e.target.checked })} />
          Customers pick up from you
        </label>
        {f.pickup.enabled && (
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="font-medium">Address they come to</span>
              <input
                autoFocus
                value={f.pickup.address}
                onChange={(e) => set('pickup', { address: e.target.value })}
                className="mt-1 block w-full rounded-lg border border-rule px-3 py-2"
                placeholder="12 Main St, Salisbury SA 5108"
              />
              {problem('pickup.address') && <span role="alert" className="mt-1 block text-brand">{problem('pickup.address')}</span>}
            </label>
            <label className="block text-sm">
              <span className="font-medium">Instructions</span> <span className="text-muted">(optional)</span>
              <input
                value={f.pickup.instructions}
                onChange={(e) => set('pickup', { instructions: e.target.value })}
                className="mt-1 block w-full rounded-lg border border-rule px-3 py-2"
                placeholder="Side door, 7am–5pm weekdays"
              />
            </label>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-rule p-5">
        <label className="flex items-center gap-3 font-semibold">
          <input type="checkbox" className="h-5 w-5" checked={f.delivery.enabled} onChange={(e) => set('delivery', { enabled: e.target.checked })} />
          You deliver locally
        </label>
        {f.delivery.enabled && (
          <div className="mt-4 space-y-3 text-sm">
            <label className="block">
              <span className="font-medium">Postcodes you deliver to</span>
              <input
                value={f.delivery.postcodes}
                onChange={(e) => set('delivery', { postcodes: e.target.value })}
                className="mt-1 block w-full rounded-lg border border-rule px-3 py-2"
                placeholder="5106-5110, 5112"
              />
              <span className="mt-1 block text-muted">Separate with commas. A range like 5106-5110 works.</span>
              {problem('delivery.postcodes') && <span role="alert" className="mt-1 block text-brand">{problem('delivery.postcodes')}</span>}
            </label>
            <div className="flex gap-4">
              <label className="block">
                <span className="font-medium">Delivery fee ($)</span>
                <input inputMode="decimal" defaultValue={dollars(f.delivery.feeCents)} onBlur={(e) => set('delivery', { feeCents: cents(e.target.value) })} className="mt-1 block w-28 rounded-lg border border-rule px-3 py-2" />
              </label>
              <label className="block">
                <span className="font-medium">Minimum order ($)</span>
                <input inputMode="decimal" defaultValue={dollars(f.delivery.minCents)} onBlur={(e) => set('delivery', { minCents: centsOrNull(e.target.value) })} placeholder="none" className="mt-1 block w-28 rounded-lg border border-rule px-3 py-2" />
              </label>
            </div>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-rule p-5">
        <label className="flex items-center gap-3 font-semibold">
          <input type="checkbox" className="h-5 w-5" checked={f.post.enabled} onChange={(e) => set('post', { enabled: e.target.checked })} />
          You post orders anywhere in Australia
        </label>
        {f.post.enabled && (
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <label className="block">
              <span className="font-medium">Name</span>
              <input value={f.post.name} onChange={(e) => set('post', { name: e.target.value })} className="mt-1 block w-48 rounded-lg border border-rule px-3 py-2" />
            </label>
            <label className="block">
              <span className="font-medium">Price ($)</span>
              <input inputMode="decimal" defaultValue={dollars(f.post.priceCents)} onBlur={(e) => set('post', { priceCents: cents(e.target.value) })} className="mt-1 block w-28 rounded-lg border border-rule px-3 py-2" />
            </label>
            <label className="block">
              <span className="font-medium">Free over ($)</span>
              <input inputMode="decimal" defaultValue={dollars(f.post.freeOverCents)} onBlur={(e) => set('post', { freeOverCents: centsOrNull(e.target.value) })} placeholder="never" className="mt-1 block w-28 rounded-lg border border-rule px-3 py-2" />
            </label>
          </div>
        )}
      </section>

      {problem('all') && <p role="alert" className="mt-6 text-sm font-semibold text-brand">{problem('all')}</p>}

      <div className="mt-8 flex items-center gap-4">
        <button type="button" disabled={busy} onClick={() => void save()} className="min-h-11 rounded-lg bg-brand px-6 font-semibold text-white disabled:opacity-40">
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved && <span role="status" className="text-sm font-semibold text-green-800">Saved. Customers will see this at checkout.</span>}
      </div>
    </main>
  )
}

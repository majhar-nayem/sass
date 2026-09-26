'use client'
import { useState } from 'react'
import { trpc, TrpcError } from '@/lib/trpc-client'

/**
 * M-03 -- connecting Stripe.
 *
 * The owner is a butcher who wants to sell hams, not a developer, so the screen answers
 * one question — can you take money yet — and gives one thing to do about it. Stripe's
 * own requirement codes are shown verbatim underneath rather than paraphrased: when
 * Stripe asks for `individual.id_number`, an invented friendlier wording is a different
 * instruction from the one Stripe's own form will give them.
 */
type State = 'unconfigured' | 'not_connected' | 'incomplete' | 'restricted' | 'ready'

const HEADLINE: Record<State, { title: string; tone: string; body: string }> = {
  unconfigured: {
    title: 'Online payments are not available yet',
    tone: 'bg-surface text-muted',
    body: 'This is something we need to switch on at our end. Nothing for you to do.',
  },
  not_connected: {
    title: 'Connect Stripe to take payments',
    tone: 'bg-surface text-muted',
    body: 'Customers pay you directly. The money goes to your bank account, not ours — we never hold it.',
  },
  incomplete: {
    title: 'Stripe still needs a few details',
    tone: 'bg-amber-100 text-amber-900',
    body: 'You have started but not finished. Stripe usually wants an ABN, a bank account and photo ID.',
  },
  restricted: {
    title: 'Stripe has paused this account',
    tone: 'bg-red-100 text-red-900',
    body: 'Your shop cannot take payments until this is sorted out with Stripe directly.',
  },
  ready: {
    title: 'You can take payments',
    tone: 'bg-green-100 text-green-900',
    body: 'Customers pay you and the money settles into your own bank account.',
  },
}

export function Payments({
  siteId,
  siteName,
  initial,
  justReturned,
}: {
  siteId: string
  siteName: string
  initial: { state: State; currentlyDue: string[]; disabledReason: string | null; canAcceptPayments: boolean }
  justReturned: boolean
}) {
  const [status, setStatus] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const h = HEADLINE[status.state]

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      const out = await trpc.mutate<{ url: string }>('store.startStripeOnboarding', { siteId })
      window.location.href = out.url
    } catch (e) {
      setError(e instanceof TrpcError ? e.message : 'Could not reach Stripe. Try again in a moment.')
      setBusy(false)
    }
  }

  async function refresh() {
    setBusy(true)
    setError(null)
    try {
      setStatus(await trpc.mutate<typeof initial>('store.syncPayments', { siteId }))
    } catch {
      setError('Could not check with Stripe just now.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-[62ch] px-6 py-12">
      <p className="text-sm text-muted">{siteName}</p>
      <h1 className="mt-1 mb-6 text-2xl font-semibold">Payments</h1>

      <div className={`rounded-xl px-5 py-4 ${h.tone}`}>
        <p className="font-semibold">{h.title}</p>
        <p className="mt-1 text-sm">{h.body}</p>
      </div>

      {/* Stripe's own words. Paraphrasing these sends people looking for the wrong thing. */}
      {status.currentlyDue.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-semibold">Stripe is waiting for:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {status.currentlyDue.map((r) => (
              <li key={r}>
                <code className="font-mono text-[0.85em]">{r}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status.disabledReason && (
        <p className="mt-4 text-sm text-muted">
          Stripe’s reason: <code className="font-mono text-[0.85em]">{status.disabledReason}</code>
        </p>
      )}

      {justReturned && status.state === 'incomplete' && (
        <p className="mt-6 rounded-lg border border-rule px-4 py-3 text-sm">
          It looks like you came back before Stripe had everything. Picking up where you left off
          is fine — nothing you entered is lost.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-6 text-sm font-semibold text-brand">
          {error}
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {status.state !== 'unconfigured' && status.state !== 'ready' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void connect()}
            className="min-h-11 rounded-lg bg-brand px-6 font-semibold text-white disabled:opacity-40"
          >
            {status.state === 'not_connected' ? 'Connect Stripe' : 'Continue with Stripe'}
          </button>
        )}
        {status.state !== 'unconfigured' && status.state !== 'not_connected' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void refresh()}
            className="min-h-11 rounded-lg border border-rule px-4 font-medium hover:bg-surface disabled:opacity-40"
          >
            Check again
          </button>
        )}
        {status.state === 'ready' && (
          <a
            href="https://dashboard.stripe.com/"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-brand underline"
          >
            Open your Stripe dashboard
          </a>
        )}
      </div>

      <p className="mt-10 border-t border-rule pt-6 text-sm text-muted">
        The Stripe account is yours. It stays yours if you ever leave us, along with your payout
        history and your customers’ receipts.
      </p>
    </main>
  )
}

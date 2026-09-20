'use client'
import { useState } from 'react'
import { trpc, TrpcError } from '@/lib/trpc-client'

/**
 * O-01 -- the domain screen.
 *
 * Concierge means an operator usually does this with the customer on the phone, so the
 * DNS records are the biggest thing here and they are copy-pasteable. The self-serve
 * wizard later is this page with fewer sharp edges, not a different feature.
 */
interface Domain {
  id: string
  hostname: string
  kind: string
  status: string
  isPrimary: boolean
  problem: string | null
  txt: string | null
}

const LABEL: Record<string, { text: string; tone: string }> = {
  active: { text: 'Live', tone: 'bg-green-100 text-green-900' },
  pending: { text: 'Waiting on DNS', tone: 'bg-surface text-muted' },
  verifying: { text: 'Checking', tone: 'bg-surface text-muted' },
  ssl_pending: { text: 'Issuing certificate', tone: 'bg-surface text-muted' },
  failed: { text: 'Needs attention', tone: 'bg-red-100 text-red-900' },
  detached: { text: 'Removed', tone: 'bg-surface text-muted' },
}

export function Domains({
  siteId,
  siteName,
  cnameTarget,
  domains: initial,
}: {
  siteId: string
  siteName: string
  cnameTarget: string
  domains: Domain[]
}) {
  const [domains, setDomains] = useState(initial)
  const [hostname, setHostname] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [instructions, setInstructions] = useState<string | null>(null)

  async function attach() {
    setBusy(true)
    setError(null)
    try {
      const r = await trpc.mutate<{ hostname: string; status: string; instructions: string }>('domain.attach', {
        siteId,
        hostname: hostname.trim(),
        primary: domains.filter((d) => d.kind === 'custom').length === 0,
      })
      setInstructions(r.instructions)
      setDomains((d) => [
        ...d,
        { id: crypto.randomUUID(), hostname: r.hostname, kind: 'custom', status: r.status, isPrimary: false, problem: null, txt: null },
      ])
      setHostname('')
    } catch (e) {
      setError(e instanceof TrpcError ? e.message : 'Could not add that domain.')
    } finally {
      setBusy(false)
    }
  }

  async function recheck(id: string) {
    setBusy(true)
    try {
      const r = await trpc.mutate<{ status: string; humanMessage: string | null }>('domain.check', { domainId: id })
      setDomains((d) => d.map((x) => (x.id === id ? { ...x, status: r.status, problem: r.humanMessage } : x)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <header className="border-b border-rule pb-4">
        <h1 className="text-xl font-semibold">Your web address</h1>
        <p className="text-sm text-muted">{siteName}</p>
      </header>

      <ul className="divide-y divide-rule">
        {domains.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 py-4">
            <div className="min-w-0 flex-1">
              <span className="font-mono text-[0.95rem]">{d.hostname}</span>
              {d.isPrimary && <span className="ml-2 text-xs text-muted">main address</span>}
              {d.problem && (
                <p className="mt-1 max-w-[46ch] text-sm leading-relaxed text-muted">{d.problem}</p>
              )}
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LABEL[d.status]?.tone ?? 'bg-surface'}`}>
              {LABEL[d.status]?.text ?? d.status}
            </span>
            {d.kind === 'custom' && d.status !== 'active' && (
              <button
                type="button"
                onClick={() => void recheck(d.id)}
                disabled={busy}
                className="min-h-9 rounded-lg border border-rule px-3 text-sm hover:bg-surface disabled:opacity-40"
              >
                Check now
              </button>
            )}
          </li>
        ))}
      </ul>

      <section className="mt-8 rounded-lg border border-rule p-5">
        <h2 className="font-semibold">Use your own domain</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          If you already own one, add it here and we&rsquo;ll tell you exactly what to change
          at your registrar. The certificate is automatic.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="host">
            Your domain
          </label>
          <input
            id="host"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="daveplumbing.com.au"
            className="min-h-11 flex-1 rounded-lg border border-rule bg-white px-3.5 font-mono text-base"
          />
          <button
            type="button"
            onClick={() => void attach()}
            disabled={busy || hostname.trim().length < 4}
            className="min-h-11 rounded-lg bg-brand px-4 font-semibold text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-brand">
            {error}
          </p>
        )}
        {instructions && (
          <pre className="mt-4 overflow-x-auto rounded-lg bg-surface p-4 text-xs leading-relaxed">
            {instructions}
          </pre>
        )}
        <p className="mt-4 text-xs text-muted">
          Everything points at <code className="font-mono">{cnameTarget}</code>.
        </p>
      </section>
    </main>
  )
}

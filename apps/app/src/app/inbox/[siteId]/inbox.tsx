'use client'
import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'

/**
 * P-09 -- the enquiry inbox.
 *
 * The screen that justifies the subscription. A tradie does not log in to admire their
 * website; they log in because someone wants work done. So the phone number is the
 * biggest thing on each row and it is a tap-to-call link, not text to copy out.
 */
interface Lead {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  message: string | null
  createdAt: string
  read: boolean
}

function when(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 8) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export function Inbox({ siteId, siteName, leads: initial }: { siteId: string; siteName: string; leads: Lead[] }) {
  const [leads, setLeads] = useState(initial)
  const [busy, setBusy] = useState(false)

  async function markRead(id: string) {
    setLeads((l) => l.map((x) => (x.id === id ? { ...x, read: true } : x)))
    await trpc.mutate('lead.markRead', { leadId: id }).catch(() => {})
  }

  async function archive(id: string) {
    setLeads((l) => l.filter((x) => x.id !== id))
    await trpc.mutate('lead.archive', { leadId: id }).catch(() => {})
  }

  async function exportCsv() {
    setBusy(true)
    try {
      const out = await trpc.mutate<{ filename: string; csv: string }>('lead.exportCsv', { siteId })
      const url = URL.createObjectURL(new Blob([out.csv], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = out.filename
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }

  const unread = leads.filter((l) => !l.read).length

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule pb-4">
        <div>
          <h1 className="text-xl font-semibold">Enquiries</h1>
          <p className="text-sm text-muted">
            {siteName}
            {unread > 0 && ` · ${unread} new`}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <a href={`/editor/${siteId}`} className="flex min-h-9 items-center rounded-lg border border-rule px-3 text-sm no-underline hover:bg-surface">
            Editor
          </a>
          <button
            type="button"
            onClick={() => void exportCsv()}
            disabled={busy || leads.length === 0}
            className="min-h-9 rounded-lg border border-rule px-3 text-sm font-medium hover:bg-surface disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </header>

      {leads.length === 0 ? (
        <div className="py-20 text-center">
          <p className="font-semibold">No enquiries yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
            When someone fills in the form on your website, it lands here and we email you
            straight away.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-rule">
          {leads.map((l) => (
            <li
              key={l.id}
              className={`flex flex-wrap items-start gap-x-4 gap-y-2 py-4 ${l.read ? 'opacity-70' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold">{l.name ?? 'Someone'}</span>
                  {!l.read && (
                    <span className="rounded-full bg-brand px-1.5 py-0.5 text-[0.65rem] font-bold text-white">
                      NEW
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted">{when(l.createdAt)}</span>
                </div>
                {l.message && <p className="mt-1 text-[0.95rem] leading-relaxed">{l.message}</p>}
                {l.email && (
                  <a href={`mailto:${l.email}`} className="mt-1 inline-block text-sm text-muted">
                    {l.email}
                  </a>
                )}
              </div>

              <div className="flex w-full items-center gap-2 sm:w-auto">
                {l.phone && (
                  // The whole point of the screen: one tap to ring them back.
                  <a
                    href={`tel:${l.phone.replace(/[^\d+]/g, '')}`}
                    onClick={() => void markRead(l.id)}
                    className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-brand px-4 font-semibold text-white no-underline sm:flex-none"
                  >
                    {l.phone}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void archive(l.id)}
                  aria-label={`Archive enquiry from ${l.name ?? 'someone'}`}
                  className="flex min-h-11 w-11 items-center justify-center rounded-lg border border-rule hover:bg-surface"
                >
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

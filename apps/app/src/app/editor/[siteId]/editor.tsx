'use client'
import { useCallback, useRef, useState } from 'react'
import { trpc, TrpcError } from '@/lib/trpc-client'

/**
 * P-05 / P-06 -- the editor.
 *
 * Chat on the left, the real website on the right. No layers panel, no breakpoints, no
 * drag handles: the owner is a plumber, and the product principle is that they never see
 * a website editor (docs/00-PRD.md §5).
 *
 * Tool calls are never shown. "Changed the colours to dark green and gold" is the same
 * information as set_theme({primary:'#173B2A'}) and it is the version the owner can act
 * on. The JSON is in the version history for us, not for them.
 */

interface Version {
  id: string
  version: number
  summary: string | null
  createdBy: string
}

type Turn =
  | { who: 'you'; text: string }
  | { who: 'awning'; text: string; skipped?: string[]; pending?: boolean }

export function Editor({
  siteId,
  siteName,
  status,
  subdomain,
  previewUrl,
  versions: initialVersions,
  quota,
  billing,
  startedFromTemplate,
}: {
  siteId: string
  siteName: string
  status: string
  subdomain: string
  previewUrl: string
  versions: Version[]
  quota: { used: number; limit: number }
  billing: { status: string; canPublish: boolean; trialDaysLeft: number | null }
  startedFromTemplate: boolean
}) {
  const [turns, setTurns] = useState<Turn[]>(
    startedFromTemplate
      ? [{
          who: 'awning',
          text: "I've made you a starting point. Tell me what to change — try \"make the heading say we do emergency callouts\" or \"change the colours to navy and orange\".",
        }]
      : [{
          who: 'awning',
          text: "Here's your website. Tell me what to change — plain words are fine.",
        }],
  )
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [versions, setVersions] = useState(initialVersions)
  const [used, setUsed] = useState(quota.used)
  const [published, setPublished] = useState(status === 'published')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  /**
   * Reload rather than postMessage. The preview is a real render of the real spec by the
   * real renderer, so what the owner sees is what visitors get — a postMessage patch
   * would be a second rendering path that can disagree with production, which is the
   * bug you find in December.
   */
  const refreshPreview = useCallback(() => {
    const f = iframeRef.current
    if (!f) return
    const url = new URL(f.src)
    url.searchParams.set('r', String(Date.now()))
    f.src = url.toString()
  }, [])

  const scroll = () =>
    requestAnimationFrame(() => logRef.current?.scrollTo({ top: 1e6, behavior: 'smooth' }))

  async function send() {
    const message = input.trim()
    if (!message || busy) return
    setInput('')
    setBusy(true)
    setTurns((t) => [...t, { who: 'you', text: message }, { who: 'awning', text: '', pending: true }])
    scroll()

    try {
      const out = await trpc.mutate<{
        kind: 'changed' | 'no-change' | 'failed' | 'undone'
        reply: string
        skipped?: string[]
        version?: { id: string; version: number; summary: string | null }
      }>('ai.chat', { siteId, message })

      setTurns((t) => [
        ...t.slice(0, -1),
        { who: 'awning', text: out.reply, ...(out.skipped?.length ? { skipped: out.skipped } : {}) },
      ])

      if (out.kind === 'changed' || out.kind === 'undone') {
        if (out.version)
          setVersions((v) => [
            { id: out.version!.id, version: out.version!.version, summary: out.version!.summary, createdBy: 'ai' },
            ...v,
          ])
        refreshPreview()
      }
      if (out.kind !== 'undone') setUsed((n) => n + 1)
    } catch (e) {
      setTurns((t) => [
        ...t.slice(0, -1),
        {
          who: 'awning',
          text: e instanceof TrpcError ? e.message : "That didn't work. Have another go?",
        },
      ])
    } finally {
      setBusy(false)
      scroll()
    }
  }

  async function undo() {
    setBusy(true)
    try {
      const v = await trpc.mutate<{ id: string; version: number; summary: string | null }>('ai.undo', { siteId })
      setVersions((prev) => [{ id: v.id, version: v.version, summary: v.summary, createdBy: 'user' }, ...prev])
      setTurns((t) => [...t, { who: 'awning', text: 'Put it back the way it was.' }])
      refreshPreview()
    } catch (e) {
      setTurns((t) => [...t, { who: 'awning', text: e instanceof TrpcError ? e.message : 'Nothing to undo.' }])
    } finally {
      setBusy(false)
      scroll()
    }
  }

  async function publish() {
    setBusy(true)
    try {
      await trpc.mutate('site.publish', { siteId })
      setPublished(true)
      setTurns((t) => [
        ...t,
        { who: 'awning', text: `Published. Your site is live at ${subdomain}.awningsites.com.` },
      ])
    } catch (e) {
      setTurns((t) => [...t, { who: 'awning', text: e instanceof TrpcError ? e.message : 'Publishing failed.' }])
    } finally {
      setBusy(false)
      scroll()
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-rule px-4 py-2.5">
        <span className="truncate font-semibold">{siteName}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            published ? 'bg-green-100 text-green-900' : 'bg-surface text-muted'
          }`}
        >
          {published ? 'Live' : 'Draft'}
        </span>
        {billing.trialDaysLeft !== null && !billing.canPublish && (
          <span className="hidden rounded-full bg-surface px-2 py-0.5 text-xs text-muted sm:inline">
            {billing.trialDaysLeft} days left in your trial
          </span>
        )}
        <span className="ml-auto hidden font-mono text-xs text-muted tabular-nums sm:inline">
          {used}/{quota.limit} changes
        </span>
        <button
          type="button"
          onClick={() => void undo()}
          disabled={busy}
          className="min-h-9 rounded-lg border border-rule px-3 text-sm font-medium hover:bg-surface disabled:opacity-40"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={busy}
          className="min-h-9 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          {published ? 'Publish changes' : billing.canPublish ? 'Publish' : 'Publish — choose a plan'}
        </button>
      </header>

      {/* Chat below the preview on a phone, beside it on a laptop. An owner checking
          something on their phone wants to see the site first. */}
      <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
        <section
          aria-label="Assistant"
          className="flex min-h-0 flex-1 flex-col border-rule md:max-w-[26rem] md:border-r"
        >
          <div ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {turns.map((t, i) => (
              <div key={i} className={t.who === 'you' ? 'text-right' : ''}>
                <div
                  className={`inline-block max-w-[85%] rounded-2xl px-3.5 py-2 text-[0.95rem] leading-relaxed ${
                    t.who === 'you' ? 'bg-brand text-white' : 'bg-surface'
                  }`}
                >
                  {t.who === 'awning' && t.pending ? <Thinking /> : t.text}
                </div>
                {t.who === 'awning' && t.skipped?.length ? (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
                    {t.skipped.map((s, j) => (
                      <li key={j}>Skipped: {s}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
            className="flex shrink-0 gap-2 border-t border-rule p-3"
          >
            <label className="sr-only" htmlFor="msg">
              What would you like to change?
            </label>
            <input
              id="msg"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              placeholder="Make the heading bigger…"
              className="min-h-11 flex-1 rounded-lg border border-rule bg-white px-3.5 text-base"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="min-h-11 rounded-lg bg-brand px-4 font-semibold text-white disabled:opacity-40"
            >
              Send
            </button>
          </form>

          {versions.length > 1 && (
            <details className="shrink-0 border-t border-rule px-4 py-2 text-sm">
              <summary className="cursor-pointer text-muted">History</summary>
              <ol className="mt-2 space-y-1">
                {versions.slice(0, 12).map((v) => (
                  <li key={v.id} className="flex gap-2 text-xs">
                    <span className="font-mono text-muted tabular-nums">v{v.version}</span>
                    <span className="truncate">{v.summary ?? '—'}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>

        <section aria-label="Preview" className="min-h-0 flex-1 bg-surface p-2 md:p-4">
          <iframe
            ref={iframeRef}
            src={previewUrl}
            title={`Preview of ${siteName}`}
            // The preview renders content generated from owner input. Sandboxed so a
            // future custom-HTML feature cannot reach the dashboard's origin, and
            // allow-same-origin is deliberately absent.
            sandbox="allow-scripts allow-forms allow-popups"
            className="h-full w-full rounded-lg border border-rule bg-white shadow-sm"
          />
        </section>
      </div>
    </div>
  )
}

function Thinking() {
  return (
    <span className="inline-flex gap-1" aria-label="Working on it">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </span>
  )
}

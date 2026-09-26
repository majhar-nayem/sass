'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { trpc, TrpcError } from '@/lib/trpc-client'

/**
 * P-01 -- the onboarding wizard.
 *
 * Seven questions. The brief's "do not make this a 30-question form" is the design:
 * every field is a chance for a busy sole trader to close the tab, and anything we skip
 * can be added later by typing a sentence. Only the first two are required.
 *
 * One question per screen rather than a long form, because on a phone a long form looks
 * like work and a single question looks like a conversation.
 */

type Answers = {
  businessName?: string
  description?: string
  suburb?: string
  state?: string
  industry?: string
  services?: string[]
  style?: string
  colours?: string
  phone?: string
  email?: string
  whatsapp?: string
  wantsEcommerce?: boolean
}

const STATES = ['SA', 'VIC', 'NSW', 'QLD', 'WA', 'TAS', 'NT', 'ACT'] as const

const INDUSTRIES: Array<[string, string]> = [
  ['plumber', 'Plumber'], ['electrician', 'Electrician'], ['builder', 'Builder'],
  ['carpenter', 'Carpenter'], ['painter', 'Painter'], ['cleaner', 'Cleaner'],
  ['mechanic', 'Mechanic'], ['landscaper', 'Landscaper'], ['removalist', 'Removalist'],
  ['barber', 'Barber'], ['hair-salon', 'Hair salon'], ['beauty', 'Beauty'],
  ['cafe', 'Café'], ['restaurant', 'Restaurant'], ['bakery', 'Bakery'],
  ['butcher', 'Butcher'], ['grocer', 'Grocer'], ['florist', 'Florist'],
  ['gift-shop', 'Gift shop'], ['retail', 'Retail'], ['personal-trainer', 'Personal trainer'],
  ['accountant', 'Accountant'], ['photographer', 'Photographer'], ['childcare', 'Childcare'],
  ['other', 'Something else'],
]

const STYLES: Array<[string, string, string]> = [
  ['bold-trade', 'Bold', 'Big type, strong colour. Reads well on a phone in the sun.'],
  ['clean-modern', 'Clean', 'Plain and uncluttered. Suits most businesses.'],
  ['premium-modern', 'Premium', 'Considered and a bit upmarket.'],
  ['warm-local', 'Warm', 'Friendly and local. Good for food and family businesses.'],
  ['minimal', 'Minimal', 'Lots of space, very little decoration.'],
]

const STEPS = 7

export function Wizard({ initial, initialStep }: { initial: Answers; initialStep: number }) {
  const router = useRouter()
  const [step, setStep] = useState(initialStep)
  const [a, setA] = useState<Answers>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Autosave, debounced. Saving only at the end would protect nobody: the drop-offs
  // happen in the middle, which is exactly what the resume link is for.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void trpc.mutate('onboarding.saveDraft', { answers: a, step }).catch(() => {})
    }, 800)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [a, step])

  const set = (patch: Answers) => setA((prev) => ({ ...prev, ...patch }))
  const canAdvance =
    step === 0
      ? Boolean(a.businessName?.trim())
      : step === 1
        ? Boolean(a.description?.trim())
        : step === STEPS - 1
          ? acceptedTerms
          : true

  async function finish() {
    setBusy(true)
    setError(null)
    try {
      const out = await trpc.mutate<{ siteId: string; note?: string }>('onboarding.complete', {
        answers: {
          businessName: a.businessName!,
          description: a.description!,
          suburb: a.suburb || undefined,
          state: a.state || undefined,
          industry: a.industry || 'other',
          services: (a.services ?? []).filter(Boolean),
          style: a.style || undefined,
          colours: a.colours || undefined,
          phone: a.phone || undefined,
          email: a.email || undefined,
          whatsapp: a.whatsapp || undefined,
          wantsEcommerce: a.wantsEcommerce ?? false,
        },
        acceptTerms: true,
      })
      router.push(`/editor/${out.siteId}${out.note ? '?note=template' : ''}`)
    } catch (e) {
      setError(e instanceof TrpcError ? e.message : 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  if (busy)
    return (
      <div className="mx-auto max-w-md px-5 py-[20vh] text-center">
        <h1 className="text-xl font-semibold">Building your website…</h1>
        <p className="mt-2 text-muted">This takes about twenty seconds.</p>
        <div className="mx-auto mt-6 h-1 w-40 overflow-hidden rounded bg-surface">
          <div className="h-full w-1/3 animate-pulse rounded bg-brand" />
        </div>
      </div>
    )

  return (
    <div className="mx-auto max-w-xl px-5 py-10 md:py-16">
      <div className="mb-8 flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded bg-surface">
          <div
            className="h-full rounded bg-brand transition-all"
            style={{ width: `${((step + 1) / STEPS) * 100}%` }}
          />
        </div>
        <span className="font-mono text-xs text-muted tabular-nums">
          {step + 1}/{STEPS}
        </span>
      </div>

      {step === 0 && (
        <Step title="What's your business called?" hint="Exactly as you'd want it on the sign.">
          <Text value={a.businessName ?? ''} onChange={(v) => set({ businessName: v })} placeholder="Dave's Gas & Plumbing" autoFocus />
        </Step>
      )}

      {step === 1 && (
        <Step title="What does your business do?" hint="A couple of sentences in your own words is plenty — we'll tidy it up.">
          <Textarea
            value={a.description ?? ''}
            onChange={(v) => set({ description: v })}
            placeholder="Two vans doing blocked drains and hot water across the northern suburbs. I answer my own phone."
            autoFocus
          />
          <Choices
            label="Which of these is closest?"
            options={INDUSTRIES}
            value={a.industry}
            onChange={(v) => set({ industry: v })}
          />
        </Step>
      )}

      {step === 2 && (
        <Step title="Where are you?" hint="People search for a trade plus a suburb, so this matters more than it looks.">
          <Text value={a.suburb ?? ''} onChange={(v) => set({ suburb: v })} placeholder="Salisbury" autoFocus />
          <Choices
            label="State"
            options={STATES.map((s) => [s, s] as [string, string])}
            value={a.state}
            onChange={(v) => set({ state: v })}
          />
        </Step>
      )}

      {step === 3 && (
        <Step title="What are your main services?" hint="Up to six. One per line.">
          <Textarea
            value={(a.services ?? []).join('\n')}
            onChange={(v) => set({ services: v.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8) })}
            placeholder={'Blocked drains\nHot water\nBurst pipes\nGas fitting'}
            autoFocus
          />
        </Step>
      )}

      {step === 4 && (
        <Step title="How should it look?" hint="You can change any of this later just by asking.">
          <div className="grid gap-2">
            {STYLES.map(([value, name, blurb]) => (
              <button
                key={value}
                type="button"
                onClick={() => set({ style: value })}
                aria-pressed={a.style === value}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  a.style === value ? 'border-brand bg-surface' : 'border-rule hover:bg-surface'
                }`}
              >
                <span className="block font-semibold">{name}</span>
                <span className="block text-sm text-muted">{blurb}</span>
              </button>
            ))}
          </div>
        </Step>
      )}

      {step === 5 && (
        <Step title="Any colours in mind?" hint="Optional. Plain words are fine — 'dark green and gold'.">
          <Text value={a.colours ?? ''} onChange={(v) => set({ colours: v })} placeholder="navy and orange" autoFocus />
        </Step>
      )}

      {step === 6 && (
        <Step title="How do people reach you?" hint="The phone number is the single most useful thing on the whole site.">
          <Field label="Phone">
            <Text value={a.phone ?? ''} onChange={(v) => set({ phone: v })} placeholder="08 8123 4567" type="tel" autoFocus />
          </Field>
          <Field label="Email">
            <Text value={a.email ?? ''} onChange={(v) => set({ email: v })} placeholder="dave@example.com.au" type="email" />
          </Field>
          <Field label="WhatsApp (optional)">
            <Text value={a.whatsapp ?? ''} onChange={(v) => set({ whatsapp: v })} placeholder="0412 345 678" type="tel" />
          </Field>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={a.wantsEcommerce ?? false}
              onChange={(e) => set({ wantsEcommerce: e.target.checked })}
              className="mt-0.5 h-5 w-5"
            />
            <span>I want to sell things online as well</span>
          </label>

          {/*
            O-05b. Unticked by default and required to proceed: a pre-ticked box
            records an agreement nobody actually gave, which is worse than no record
            at all. The links open in a new tab so seven answers are not lost to
            reading the terms.
          */}
          <label className="mt-6 flex items-start gap-3 border-t border-rule pt-6 text-sm">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5 h-5 w-5"
            />
            <span>
              I agree to the{' '}
              <a href="/legal/terms" target="_blank" rel="noreferrer" className="text-brand underline">
                terms of service
              </a>{' '}
              and the{' '}
              <a href="/legal/acceptable-use" target="_blank" rel="noreferrer" className="text-brand underline">
                acceptable use policy
              </a>
              .
            </span>
          </label>
        </Step>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm font-semibold text-brand">
          {error}
        </p>
      )}

      <div className="mt-8 flex items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="min-h-11 rounded-lg border border-rule px-4 font-medium hover:bg-surface"
          >
            Back
          </button>
        )}
        <button
          type="button"
          disabled={!canAdvance}
          onClick={() => (step === STEPS - 1 ? void finish() : setStep((s) => s + 1))}
          className="ml-auto min-h-11 rounded-lg bg-brand px-6 font-semibold text-white disabled:opacity-40"
        >
          {step === STEPS - 1 ? 'Build my website' : 'Next'}
        </button>
      </div>

      <p className="mt-6 text-xs text-muted">
        Saved as you go — you can close this and pick it up later.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ fields --- */

function Step({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-balance text-2xl font-semibold md:text-3xl">{title}</h1>
      {hint && <p className="mt-2 text-muted">{hint}</p>}
      <div className="mt-6 grid gap-4">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {children}
    </label>
  )
}

function Text({
  value, onChange, placeholder, type = 'text', autoFocus,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; autoFocus?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={type === 'tel' ? 'tel' : type === 'email' ? 'email' : 'text'}
      className="min-h-12 w-full rounded-lg border border-rule bg-white px-4 text-base"
    />
  )
}

function Textarea({
  value, onChange, placeholder, autoFocus,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean
}) {
  return (
    <textarea
      value={value}
      autoFocus={autoFocus}
      rows={5}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full resize-y rounded-lg border border-rule bg-white px-4 py-3 text-base"
    />
  )
}

function Choices({
  label, options, value, onChange,
}: {
  label: string; options: Array<[string, string]>; value?: string; onChange: (v: string) => void
}) {
  return (
    <fieldset className="mt-2">
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={`min-h-9 rounded-full border px-3 text-sm transition-colors ${
              value === v ? 'border-brand bg-brand text-white' : 'border-rule hover:bg-surface'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

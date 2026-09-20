'use client'
import { useState } from 'react'
import type { SectionSpec } from '@awning/spec'
import { Heading, Lede } from './primitives.js'

type Props = Extract<SectionSpec, { type: 'contactForm' }>['props'] & { headingId?: string }

/**
 * The single most valuable component in the catalogue: an enquiry in the owner's inbox
 * is the ROI they can see. Everything here is in service of that one conversion.
 *
 * Posts to the renderer's form endpoint, which applies Turnstile, a honeypot and a rate
 * limit before writing (P-08). The form works without the CSS and degrades to a normal
 * POST if hydration never happens.
 */
export function ContactForm({
  heading,
  subheading,
  submitLabel,
  successMessage,
  fields,
  headingId,
}: Props) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    setState('sending')
    setError(null)
    try {
      const res = await fetch(form.action, { method: 'POST', body: new FormData(form) })
      if (!res.ok) throw new Error(String(res.status))
      setState('sent')
      form.reset()
    } catch {
      setState('error')
      // Never lose what they typed: the form stays filled and they can retry.
      setError("That didn't send. Please try again, or give us a call.")
    }
  }

  if (state === 'sent') {
    return (
      <div className="mx-auto max-w-[46ch] text-center">
        <Heading id={headingId}>Thanks — we&rsquo;ve got it.</Heading>
        <p className="mt-3 leading-relaxed opacity-80">
          {successMessage ?? "We'll get back to you as soon as we can."}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[46ch]">
      {heading && <Heading id={headingId}>{heading}</Heading>}
      {subheading && <Lede>{subheading}</Lede>}

      <form onSubmit={onSubmit} action="" method="post" className="mt-6 grid gap-4" noValidate>
        {/* Bots fill every field they find; people never see this one. */}
        <div className="absolute left-[-9999px]" aria-hidden="true">
          <label htmlFor="company_website">Leave this blank</label>
          <input id="company_website" name="company_website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        {fields.map((f) => {
          const id = `f-${f.key}`
          const common =
            'min-h-11 w-full rounded-[var(--radius)] border border-current/20 bg-white/80 px-3.5 py-2.5 text-base'
          return (
            <div key={f.key} className="grid gap-1.5">
              <label htmlFor={id} className="text-sm font-semibold">
                {f.label}
                {f.required && (
                  <span className="ml-1 text-brand-accent" aria-hidden="true">
                    *
                  </span>
                )}
                {f.required && <span className="sr-only"> (required)</span>}
              </label>

              {f.type === 'textarea' ? (
                <textarea
                  id={id}
                  name={f.key}
                  required={f.required}
                  rows={4}
                  placeholder={f.placeholder}
                  className={`${common} min-h-28 resize-y`}
                />
              ) : f.type === 'select' ? (
                <select id={id} name={f.key} required={f.required} className={common}>
                  <option value="">Please choose&hellip;</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : f.type === 'checkbox' ? (
                <input
                  id={id}
                  name={f.key}
                  type="checkbox"
                  required={f.required}
                  className="h-5 w-5"
                />
              ) : (
                <input
                  id={id}
                  name={f.key}
                  type={f.type}
                  required={f.required}
                  placeholder={f.placeholder}
                  // Australian mobiles and landlines both; lets the phone keypad appear.
                  inputMode={f.type === 'tel' ? 'tel' : f.type === 'email' ? 'email' : 'text'}
                  autoComplete={
                    f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : f.key === 'name' ? 'name' : 'on'
                  }
                  className={common}
                />
              )}
            </div>
          )
        })}

        {error && (
          <p role="alert" className="text-sm font-semibold text-brand-accent">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={state === 'sending'}
          className="mt-1 inline-flex min-h-11 items-center justify-center rounded-[var(--radius)] bg-brand-accent px-5 py-2.5 font-semibold text-brand-on-accent disabled:opacity-60"
        >
          {state === 'sending' ? 'Sending…' : (submitLabel ?? 'Send enquiry')}
        </button>
      </form>
    </div>
  )
}

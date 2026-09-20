'use client'
import { useEffect, useState } from 'react'
import type { SectionSpec } from '@awning/spec'
import { Button, Heading } from './primitives.js'

type Props = Extract<SectionSpec, { type: 'countdown' }>['props'] & { headingId?: string }

function remaining(endsAt: string) {
  const ms = new Date(endsAt).getTime() - Date.now()
  if (ms <= 0) return null
  const s = Math.floor(ms / 1000)
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  }
}

/**
 * The end date comes from the owner and is validated as a real, future, within-a-year
 * deadline before it can be stored (packages/spec/src/validate.ts). There is no
 * evergreen mode and no auto-reset: a countdown that resets is misleading conduct under
 * the Australian Consumer Law, and the ACCC has pursued exactly this.
 *
 * Renders the correct value on the server so it is right in the first paint and in the
 * HTML a crawler sees, then ticks on the client.
 */
export function Countdown({ heading, endsAt, expiredMessage, cta, headingId }: Props) {
  const [left, setLeft] = useState(() => remaining(endsAt))
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const id = setInterval(() => setLeft(remaining(endsAt)), 1000)
    return () => clearInterval(id)
  }, [endsAt])

  if (!left) {
    return (
      <div className="text-center">
        <Heading id={headingId}>{expiredMessage ?? 'This offer has now closed.'}</Heading>
      </div>
    )
  }

  const units: Array<[string, number]> = [
    ['days', left.days],
    ['hours', left.hours],
    ['minutes', left.minutes],
    ['seconds', left.seconds],
  ]

  return (
    <div className="text-center">
      <Heading id={headingId}>{heading}</Heading>

      {/* One accessible sentence; the tiles are decorative duplication for sighted users. */}
      <p className="sr-only" aria-live="off">
        {left.days} days, {left.hours} hours and {left.minutes} minutes remaining.
      </p>

      <div className="mt-6 flex justify-center gap-3 md:gap-5" aria-hidden="true">
        {units.map(([label, value]) => (
          <div
            key={label}
            className="min-w-[4.2rem] rounded-[var(--radius)] bg-white/70 px-3 py-3 shadow-[var(--shadow)] ring-1 ring-black/5 md:min-w-[5.5rem]"
          >
            <span className="block font-heading text-2xl font-bold tabular-nums md:text-4xl">
              {/* Seconds only start moving once mounted, so server and client HTML agree. */}
              {label === 'seconds' && !mounted ? '--' : String(value).padStart(2, '0')}
            </span>
            <span className="text-[0.68rem] tracking-[0.1em] uppercase opacity-60">{label}</span>
          </div>
        ))}
      </div>

      {cta && (
        <div className="mt-7 flex justify-center">
          <Button cta={cta} />
        </div>
      )}
    </div>
  )
}

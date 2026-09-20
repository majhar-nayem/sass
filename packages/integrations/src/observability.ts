import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Web Crypto, not node:crypto.
 *
 * This module is reachable from `sentry.server.config.ts`, which Next pulls into the
 * EDGE bundle as well as the node one. A `node:crypto` import there is unresolvable,
 * and under `next dev` that takes down every route in the app with a bundler error —
 * the production build happens to tolerate it, so it looks fine in CI and nobody can
 * run the dashboard locally. `crypto.randomUUID` is a global in Node 19+, in the edge
 * runtime and in browsers, so the portable one costs nothing.
 */
const randomUUID = (): string => globalThis.crypto.randomUUID()

/**
 * F-11 -- structured logs and error reporting.
 *
 * Two things this has to get right, in order.
 *
 * First, never ship customer data to a third party. This platform holds enquiry forms
 * full of names, phone numbers and addresses belonging to people who never heard of us
 * — they gave them to a plumber. Under the Australian Privacy Principles those are not
 * ours to forward to an error tracker in Frankfurt, and an error tracker is exactly
 * where they end up by default, inside request bodies and breadcrumbs. So scrubbing is
 * the default and enabling PII is not an option this module offers.
 *
 * Second, an error has to be traceable to a tenant. "Something threw" is not actionable
 * when 50 businesses share a renderer; "site X threw on section Y" is.
 *
 * Deliberately free of any Sentry dependency: apps register a reporter. That keeps the
 * SDK out of packages that do not need it and makes all of this testable without it.
 */

export interface ErrorReporter {
  (error: unknown, context: { tags: Record<string, string>; extra: Record<string, unknown> }): void
}

export interface RequestContext {
  requestId: string
  orgId?: string
  siteId?: string
  userId?: string
  /** 'app' | 'render' — which deployable, since both write to the same log stream. */
  service?: string
  route?: string
}

/**
 * Held on globalThis, the same way the Prisma clients are, and for a sharper reason.
 *
 * Next bundles `instrumentation.ts` separately from the server chunks that serve a
 * request. A module-scope `const` therefore exists TWICE, with separate state: the
 * request handler writes context into one copy, and `onRequestError` reads an empty
 * one. Everything still runs and every log line still looks right — the errors simply
 * arrive untagged, which is the failure this whole ticket exists to prevent.
 */
interface ObservabilityState {
  storage: AsyncLocalStorage<RequestContext>
  reporter: ErrorReporter | null
}
const globalForObservability = globalThis as unknown as { __awningObservability?: ObservabilityState }
const state: ObservabilityState = (globalForObservability.__awningObservability ??= {
  storage: new AsyncLocalStorage<RequestContext>(),
  reporter: null,
})
const storage = state.storage

export function runWithRequestContext<T>(ctx: Partial<RequestContext>, fn: () => T): T {
  const parent = storage.getStore()
  return storage.run({ ...parent, requestId: ctx.requestId ?? parent?.requestId ?? randomUUID(), ...ctx }, fn)
}

export const currentContext = (): RequestContext | undefined => storage.getStore()

/**
 * Adds to the context of the request already in flight.
 *
 * Used where the tenant only becomes known part-way through: the tRPC org middleware
 * verifies membership before an org id can be trusted, and by then the request has been
 * logging for several milliseconds.
 */
export function enrichRequestContext(patch: Partial<RequestContext>): void {
  const store = storage.getStore()
  if (store) Object.assign(store, patch)
}

/** A request id from the edge if there is one, so logs join up across hops. */
export function requestIdFrom(headers: Headers): string {
  return (
    headers.get('x-request-id') ??
    headers.get('cf-ray') ??
    headers.get('fly-request-id') ??
    randomUUID()
  )
}

// --------------------------------------------------------------------- scrubbing

const SECRET_SEGMENTS = new Set([
  'pass', 'password', 'secret', 'token', 'key', 'apikey', 'auth', 'authorization',
  'cookie', 'session', 'credential', 'credentials', 'signature', 'otp', 'dsn',
])
const PERSON_SEGMENTS = new Set([
  'email', 'phone', 'mobile', 'name', 'firstname', 'lastname', 'fullname', 'address',
  'street', 'suburb', 'postcode', 'abn', 'ip', 'message', 'note', 'notes', 'comment',
  'comments', 'body',
])

/**
 * Key names are matched by SEGMENT, not by substring.
 *
 * A substring match reads "description" as containing "ip" and redacts it, and reads
 * "hostname" as containing "name" — so the fields that make an error diagnosable
 * disappear while the developer assumes the scrubber is working.
 */
function segmentsOf(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((p) => p.toLowerCase())
    .filter(Boolean)
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g
// Australian numbers as people actually type them. Anchored against digits on both
// sides: an unanchored pattern matches the TAIL of a longer number and leaves the
// first few digits sitting in the log.
const PHONE =
  /(?<!\d)(?:\(0[2-8]\)[ -]?\d{4}[ -]?\d{4}|(?:\+?61[ -]?|0)4\d{2}[ -]?\d{3}[ -]?\d{3}|(?:\+?61[ -]?|0)[2-8][ -]?\d{4}[ -]?\d{4})(?!\d)/g

/** Free text that may carry an address or a phone number typed into a form. */
export function redactText(input: string): string {
  return input.replace(EMAIL, '[email]').replace(PHONE, '[phone]')
}

/**
 * Redacts a structure before it leaves the process.
 *
 * Keys are matched by name rather than value: a field called `customerEmail` is
 * personal information whether or not its contents look like an email address, and
 * guessing from the value alone misses the empty and the malformed.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]'
  if (value == null) return value
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1))
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'object') return '[unserialisable]'

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const seg = segmentsOf(k)
    if (seg.some((p) => SECRET_SEGMENTS.has(p))) out[k] = '[redacted]'
    else if (seg.some((p) => PERSON_SEGMENTS.has(p)))
      out[k] = typeof v === 'string' || typeof v === 'number' ? '[personal]' : scrub(v, depth + 1)
    else out[k] = scrub(v, depth + 1)
  }
  return out
}

// ----------------------------------------------------------------------- logging

export type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = (): number => LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20

/**
 * One JSON object per line on stdout.
 *
 * Fly collects stdout and ships it on, so there is no Axiom client here and no token to
 * leak from the app — the shipper is configured once at the platform, and the app's job
 * is to emit something a machine can query. `request_id` is on every line, which is the
 * whole point: it is what turns twelve unrelated lines into one story.
 */
export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold()) return
  const ctx = currentContext()
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    request_id: ctx?.requestId,
    service: ctx?.service ?? process.env.APP,
    org_id: ctx?.orgId,
    site_id: ctx?.siteId,
    user_id: ctx?.userId,
    route: ctx?.route,
    ...(scrub(fields) as Record<string, unknown>),
  }
  for (const k of Object.keys(line)) if (line[k as keyof typeof line] === undefined) delete line[k as keyof typeof line]
  const out = JSON.stringify(line)
  if (level === 'error' || level === 'warn') console.error(out)
  else console.log(out)
}

export const logger = {
  debug: (e: string, f?: Record<string, unknown>) => log('debug', e, f),
  info: (e: string, f?: Record<string, unknown>) => log('info', e, f),
  warn: (e: string, f?: Record<string, unknown>) => log('warn', e, f),
  error: (e: string, f?: Record<string, unknown>) => log('error', e, f),
}

// --------------------------------------------------------------------- reporting

/** Apps call this from their Sentry config. Unset, errors are logged and nothing more. */
export function setErrorReporter(fn: ErrorReporter | null): void {
  state.reporter = fn
}

/**
 * Report an error once: to the log stream always, to Sentry when one is registered.
 *
 * Tags carry the tenant. Everything else goes through the scrubber, including the
 * caller's own extras — the point of a single funnel is that nobody has to remember.
 */
export function reportError(error: unknown, extra: Record<string, unknown> = {}): void {
  const ctx = currentContext()
  const tags: Record<string, string> = {}
  for (const [k, v] of Object.entries({
    org_id: ctx?.orgId,
    site_id: ctx?.siteId,
    service: ctx?.service ?? process.env.APP,
    route: ctx?.route,
  }))
    if (v) tags[k] = v

  // Logged as `err`, not `message`: a field called `message` is a form submission and
  // is redacted by key, which would throw away the one line that says what broke. The
  // error's own text still goes through redactText, because it often quotes user input.
  const message = error instanceof Error ? error.message : String(error)
  logger.error('error', { err: redactText(message), ...extra })

  try {
    state.reporter?.(error, {
      tags,
      extra: scrub({ ...extra, request_id: ctx?.requestId }) as Record<string, unknown>,
    })
  } catch {
    // An error tracker that throws must not become the outage.
  }
}

// ------------------------------------------------------------- outbound events

/** The subset of a Sentry event this needs to touch, so no SDK type is imported. */
export interface OutboundEvent {
  request?: {
    url?: string
    query_string?: unknown
    cookies?: unknown
    data?: unknown
    headers?: Record<string, string>
  }
  user?: unknown
  extra?: Record<string, unknown>
}

/**
 * Last gate before an event leaves the process.
 *
 * Kept here, and tested, because it is the privacy boundary of the whole system and
 * "we set sendDefaultPii to false" is not the same as checking. Deleting
 * `query_string` on its own is the trap: `url` carries the identical values and it is
 * `url` that actually gets sent.
 */
export function scrubEvent<T extends OutboundEvent>(event: T): T {
  if (event.request) {
    delete event.request.cookies
    delete event.request.data
    delete event.request.query_string
    if (event.request.url) event.request.url = event.request.url.split('?')[0]
    if (event.request.headers)
      event.request.headers = scrub(event.request.headers) as Record<string, string>
  }
  delete event.user
  if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>
  return event
}

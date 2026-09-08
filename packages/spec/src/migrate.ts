import { SPEC_VERSION } from './spec.js'

/**
 * S-03 — spec migrations.
 *
 * The moment a real customer has a published site, the spec schema is a public API.
 * A stored spec is never rewritten in place: `site_versions` rows are immutable, so a
 * migration produces a new object and the caller decides whether to persist it.
 *
 * Run lazily on read (no backfill, no downtime) and eagerly in a nightly job so old
 * versions do not accumulate migration debt.
 */
export type AnySpec = { specVersion: number } & Record<string, unknown>

export type Migration = (spec: AnySpec) => AnySpec

/**
 * Keyed by the version each migration produces. To add one: bump SPEC_VERSION in
 * spec.ts and add the matching entry here. The parity test asserts the chain is
 * complete, so a forgotten migration fails CI rather than production.
 */
export const MIGRATIONS: Record<number, Migration> = {
  // 2: (s) => { ...rename hero.size → hero.height...; s.specVersion = 2; return s },
}

export class SpecTooNewError extends Error {
  constructor(found: number) {
    super(
      `Spec version ${found} is newer than this build understands (${SPEC_VERSION}). ` +
        `This renderer is behind — do not attempt to render it.`,
    )
    this.name = 'SpecTooNewError'
  }
}

export function migrateSpec(spec: AnySpec): AnySpec {
  if (typeof spec?.specVersion !== 'number')
    throw new TypeError('spec is missing specVersion')

  // A rolling deploy means an old renderer can meet a new spec. Fail loudly rather
  // than rendering a document we cannot read correctly.
  if (spec.specVersion > SPEC_VERSION) throw new SpecTooNewError(spec.specVersion)

  let out = spec
  while (out.specVersion < SPEC_VERSION) {
    const next = out.specVersion + 1
    const m = MIGRATIONS[next]
    if (!m) throw new Error(`No migration to spec version ${next}. The chain is broken.`)
    out = m(structuredClone(out))
    if (out.specVersion !== next)
      throw new Error(`Migration to ${next} did not set specVersion (left it at ${out.specVersion}).`)
  }
  return out
}

export function needsMigration(spec: AnySpec): boolean {
  return spec.specVersion < SPEC_VERSION
}

import { describe, expect, it } from 'vitest'
import { MIGRATIONS, migrateSpec, needsMigration, SpecTooNewError } from '../migrate.js'
import { SPEC_VERSION } from '../spec.js'

describe('migrateSpec', () => {
  it('returns a current spec unchanged', () => {
    const s = { specVersion: SPEC_VERSION, site: { businessName: 'X' } }
    expect(migrateSpec(s)).toEqual(s)
    expect(needsMigration(s)).toBe(false)
  })

  it('refuses a spec newer than this build — a rolling deploy will produce one', () => {
    expect(() => migrateSpec({ specVersion: SPEC_VERSION + 1 })).toThrow(SpecTooNewError)
  })

  it('rejects a spec with no version', () => {
    expect(() => migrateSpec({} as never)).toThrow(TypeError)
  })

  /**
   * The chain must be unbroken from 1 to SPEC_VERSION. Bumping the version without
   * adding a migration fails here rather than on a customer's published site.
   */
  it('has a complete migration chain', () => {
    for (let v = 2; v <= SPEC_VERSION; v++) {
      expect(MIGRATIONS[v], `missing migration to spec version ${v}`).toBeTypeOf('function')
    }
  })

  it('does not mutate the input', () => {
    const s = { specVersion: SPEC_VERSION, site: { businessName: 'X' } }
    const before = JSON.stringify(s)
    migrateSpec(s)
    expect(JSON.stringify(s)).toBe(before)
  })
})

import { describe, expect, it } from 'vitest'
import { formatAbn, isValidAbn, normaliseAbn } from '../abn.js'

/** The algorithm and the worked example are the ABR's (abr.business.gov.au/Help/AbnFormat). */
describe('ABN check digits', () => {
  it('accepts the ABR’s own worked example', () => expect(isValidAbn('51824753556')).toBe(true))
  it('accepts it typed with spaces', () => expect(isValidAbn('51 824 753 556')).toBe(true))

  // Eleven digits is a format. A single transposition is exactly what the check catches.
  it('rejects a transposed digit that is still eleven digits long', () => {
    expect(isValidAbn('51824753565')).toBe(false)
    expect(isValidAbn('15824753556')).toBe(false)
  })
  it('rejects one digit out', () => expect(isValidAbn('51824753557')).toBe(false))
  it('rejects the wrong length, empty, and nothing', () => {
    for (const v of ['5182475355', '518247535561', '', null, undefined]) expect(isValidAbn(v)).toBe(false)
  })
})

describe('formatting', () => {
  it('groups the way the ABR prints it', () => expect(formatAbn('51824753556')).toBe('51 824 753 556'))
  it('normalises pasted punctuation', () => expect(normaliseAbn('51-824-753-556 ')).toBe('51824753556'))
})

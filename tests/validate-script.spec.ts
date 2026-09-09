import { describe, expect, it } from 'vitest'

import { validateScript } from '../src/schemas/validate.ts'
import { readJsonFixture } from './helpers.ts'

/** The outline every script fixture in this file is checked against. */
const outline = () => readJsonFixture('outlines', 'valid-basic.json')

const INVALID_FIXTURES: Array<[fixture: string, mustMention: RegExp]> = [
  ['invalid-heading-mismatch.json', /\/1\/heading.*heading mismatch/],
  ['invalid-missing-script-text.json', /\/1:.*missing required property "script_text"/],
  ['invalid-not-an-array.json', /\(root\):.*array/],
]

describe('validateScript — valid fixture', () => {
  it('accepts a script whose headings match the outline exactly, in order', () => {
    const result = validateScript(outline(), readJsonFixture('scripts', 'valid-basic.json'))
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })
})

describe('validateScript — invalid fixtures', () => {
  it.each(INVALID_FIXTURES)('rejects %s and names the violated rule', (fixture, mustMention) => {
    const result = validateScript(outline(), readJsonFixture('scripts', fixture))

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.join('\n')).toMatch(mustMention)
  })

  it('quotes both the expected and the actual heading on a mismatch', () => {
    const result = validateScript(outline(), readJsonFixture('scripts', 'invalid-heading-mismatch.json'))
    const message = result.errors.join('\n')
    expect(message).toContain('"What Polling Actually Cost Us"')
    expect(message).toContain('"What Polling Really Cost Us"')
  })
})

describe('validateScript — cross-field checks the schema cannot express', () => {
  const script = () =>
    structuredClone(readJsonFixture('scripts', 'valid-basic.json')) as Array<{
      heading: string
      script_text: string
    }>

  it('rejects a script with too few entries and reports both counts', () => {
    const short = script().slice(0, 3)
    const result = validateScript(outline(), short)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(/3 entries but the outline has 4 slides/)
  })

  it('rejects a script with too many entries', () => {
    const long = [...script(), { heading: 'Bonus Slide', script_text: 'An extra entry.' }]
    const result = validateScript(outline(), long)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(/5 entries but the outline has 4 slides/)
  })

  it('rejects correct headings supplied in the wrong order', () => {
    const swapped = script()
    const [first, second] = [swapped[0]!, swapped[1]!]
    swapped[0] = second
    swapped[1] = first

    const result = validateScript(outline(), swapped)
    expect(result.valid).toBe(false)
    // The first divergence is at index 0, and that is what should be reported.
    expect(result.errors.join('\n')).toMatch(/\/0\/heading.*heading mismatch/)
  })

  it('reports the first mismatching index, not a later one', () => {
    const drifted = script()
    drifted[2]!.heading = 'Changed Third'
    drifted[3]!.heading = 'Changed Fourth'
    expect(validateScript(outline(), drifted).errors.join('\n')).toMatch(/\/2\/heading/)
  })

  it('rejects a heading that differs only by trailing whitespace', () => {
    const drifted = script()
    drifted[0]!.heading = `${drifted[0]!.heading} `
    const result = validateScript(outline(), drifted)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(/\/0\/heading/)
  })

  it('rejects a heading that differs only by letter case', () => {
    const drifted = script()
    drifted[0]!.heading = drifted[0]!.heading.toUpperCase()
    expect(validateScript(outline(), drifted).valid).toBe(false)
  })
})

describe('validateScript — schema-level checks', () => {
  it('rejects an empty script array', () => {
    const result = validateScript(outline(), [])
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(/1 item/)
  })

  it('rejects an unknown property on an entry, naming it', () => {
    const script = structuredClone(readJsonFixture('scripts', 'valid-basic.json')) as Array<
      Record<string, unknown>
    >
    script[0]!['duration_seconds'] = 45
    expect(validateScript(outline(), script).errors.join('\n')).toMatch(
      /unknown property "duration_seconds"/,
    )
  })

  it('rejects an empty script_text', () => {
    const script = structuredClone(readJsonFixture('scripts', 'valid-basic.json')) as Array<{
      script_text: string
    }>
    script[0]!.script_text = ''
    expect(validateScript(outline(), script).errors.join('\n')).toMatch(/\/0\/script_text/)
  })

  it('rejects a script_text over 2000 characters', () => {
    const script = structuredClone(readJsonFixture('scripts', 'valid-basic.json')) as Array<{
      script_text: string
    }>
    script[0]!.script_text = 'x'.repeat(2001)
    expect(validateScript(outline(), script).errors.join('\n')).toMatch(/\/0\/script_text.*2000/)
  })
})

describe('validateScript — malformed outline', () => {
  it('blames the outline rather than the script when the outline is invalid', () => {
    const result = validateScript(
      readJsonFixture('outlines', 'invalid-missing-title.json'),
      readJsonFixture('scripts', 'valid-basic.json'),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(/outline is not a valid outline/)
    expect(result.errors.join('\n')).toMatch(/missing required property "title"/)
  })

  it.each([
    ['null', null],
    ['a string', 'not an outline'],
    ['an array', []],
  ])('rejects %s as an outline without throwing', (_label, badOutline) => {
    const result = validateScript(badOutline, readJsonFixture('scripts', 'valid-basic.json'))
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

import { describe, expect, it } from 'vitest'

import { validateOutline } from '../src/schemas/validate.ts'
import { readJsonFixture } from './helpers.ts'

const VALID_FIXTURES = [
  'valid-minimal.json',
  'valid-basic.json',
  'valid-max-key-points.json',
  'valid-cjk.json',
  'valid-boundary-lengths.json',
] as const

/**
 * Each invalid fixture is paired with a substring that must appear in the
 * reported errors. Asserting only `valid === false` would pass even if the
 * validator reported an unrelated problem, which is exactly the failure mode
 * that makes a model's retry loop spin.
 */
const INVALID_FIXTURES: Array<[fixture: string, mustMention: RegExp]> = [
  ['invalid-missing-title.json', /missing required property "title"/],
  ['invalid-empty-slides.json', /\/slides:.*fewer than 3 items/],
  ['invalid-extra-property.json', /unknown property "transition" is not allowed/],
  ['invalid-key-points-wrong-type.json', /\/slides\/0\/key_points:.*array/],
  ['invalid-too-many-slides.json', /\/slides:.*more than 30 items/],
]

describe('validateOutline — valid fixtures', () => {
  it.each(VALID_FIXTURES)('accepts %s with no errors', (fixture) => {
    const result = validateOutline(readJsonFixture('outlines', fixture))
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })
})

describe('validateOutline — invalid fixtures', () => {
  it.each(INVALID_FIXTURES)('rejects %s and names the violated rule', (fixture, mustMention) => {
    const result = validateOutline(readJsonFixture('outlines', fixture))

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.join('\n')).toMatch(mustMention)
  })
})

describe('validateOutline — non-object input', () => {
  it.each([
    ['null', null],
    ['a string', 'not an outline'],
    ['a number', 42],
    ['an array', []],
    ['undefined', undefined],
  ])('rejects %s with a non-empty error list', (_label, candidate) => {
    const result = validateOutline(candidate)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('validateOutline — boundary conditions', () => {
  const base = () => structuredClone(readJsonFixture('outlines', 'valid-minimal.json')) as {
    title: string
    slides: Array<{ heading: string; key_points: string[]; notes_hint: string }>
  }

  it('rejects an empty title', () => {
    const outline = base()
    outline.title = ''
    const result = validateOutline(outline)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(/\/title/)
  })

  it('rejects a title over 120 characters', () => {
    const outline = base()
    outline.title = 'x'.repeat(121)
    expect(validateOutline(outline).errors.join('\n')).toMatch(/\/title.*120/)
  })

  it('rejects a heading over 80 characters', () => {
    const outline = base()
    outline.slides[0]!.heading = 'x'.repeat(81)
    expect(validateOutline(outline).errors.join('\n')).toMatch(/\/slides\/0\/heading.*80/)
  })

  it('rejects a key point over 200 characters', () => {
    const outline = base()
    outline.slides[0]!.key_points = ['x'.repeat(201)]
    expect(validateOutline(outline).errors.join('\n')).toMatch(/\/slides\/0\/key_points\/0.*200/)
  })

  it('rejects more than 8 key points', () => {
    const outline = base()
    outline.slides[0]!.key_points = Array.from({ length: 9 }, (_, i) => `point ${i}`)
    expect(validateOutline(outline).errors.join('\n')).toMatch(/\/slides\/0\/key_points.*8 items/)
  })

  it('rejects an empty key_points array', () => {
    const outline = base()
    outline.slides[0]!.key_points = []
    expect(validateOutline(outline).errors.join('\n')).toMatch(/\/slides\/0\/key_points.*1 item/)
  })

  it('rejects a notes_hint over 300 characters', () => {
    const outline = base()
    outline.slides[0]!.notes_hint = 'x'.repeat(301)
    expect(validateOutline(outline).errors.join('\n')).toMatch(/\/slides\/0\/notes_hint.*300/)
  })

  it('accepts an empty notes_hint, which has no minimum length', () => {
    const outline = base()
    outline.slides[0]!.notes_hint = ''
    expect(validateOutline(outline).valid).toBe(true)
  })

  it('rejects an unknown property at the root, naming it', () => {
    const outline = { ...base(), theme: 'gaia' }
    expect(validateOutline(outline).errors.join('\n')).toMatch(/unknown property "theme"/)
  })

  it('reports every violation at once rather than stopping at the first', () => {
    const outline = base()
    outline.title = ''
    outline.slides[0]!.heading = ''
    const result = validateOutline(outline)
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
    expect(result.errors.join('\n')).toMatch(/\/title/)
    expect(result.errors.join('\n')).toMatch(/\/slides\/0\/heading/)
  })
})

import { describe, expect, it } from 'vitest'

import { chunk } from '../src/retrieval/chunk.ts'
import { tokenize } from '../src/retrieval/tokenize.ts'
import { readFixture } from './helpers.ts'

/** A paragraph of `count` distinct one-token words, so token counts are easy to reason about. */
function paragraphOfWords(count: number, prefix = 'w'): string {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(' ')
}

describe('chunk', () => {
  it('keeps a short paragraph as exactly one chunk, verbatim', () => {
    const text = 'A short paragraph that fits comfortably inside the token budget.'
    const chunks = chunk(text, { path: '/notes.md', maxTokens: 150, overlap: 30 })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.text).toBe(text)
    expect(chunks[0]!.tokens).toEqual(tokenize(text))
    expect(chunks[0]!.path).toBe('/notes.md')
    expect(chunks[0]!.index).toBe(0)
  })

  it('splits on blank lines, one chunk per paragraph', () => {
    const text = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.'
    const chunks = chunk(text, { path: '/notes.md' })

    expect(chunks).toHaveLength(3)
    expect(chunks.map((c) => c.text)).toEqual([
      'First paragraph here.',
      'Second paragraph here.',
      'Third paragraph here.',
    ])
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2])
  })

  it('ignores blank and whitespace-only paragraphs', () => {
    const chunks = chunk('One.\n\n   \n\nTwo.\n\n\n\nThree.', { path: '/notes.md' })
    expect(chunks.map((c) => c.text)).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('windows an oversized paragraph with exactly the configured overlap', () => {
    const maxTokens = 10
    const overlap = 3
    const chunks = chunk(paragraphOfWords(25), { path: '/notes.md', maxTokens, overlap })

    expect(chunks.length).toBeGreaterThan(1)

    for (const piece of chunks) {
      expect(piece.tokens.length).toBeLessThanOrEqual(maxTokens)
    }

    // The defining property: consecutive windows share exactly `overlap` tokens.
    for (let i = 1; i < chunks.length; i++) {
      const previous = chunks[i - 1]!
      // Only full-width windows are followed by a window that overlaps them fully.
      if (previous.tokens.length < maxTokens) continue
      expect(chunks[i]!.tokens.slice(0, overlap)).toEqual(previous.tokens.slice(-overlap))
    }
  })

  it('advances by maxTokens - overlap tokens per window', () => {
    const chunks = chunk(paragraphOfWords(25), { path: '/notes.md', maxTokens: 10, overlap: 3 })
    // step = 7, so windows start at token 0, 7, 14, 21 -> 4 windows over 25 tokens.
    expect(chunks).toHaveLength(4)
    expect(chunks[0]!.tokens[0]).toBe('w0')
    expect(chunks[1]!.tokens[0]).toBe('w7')
    expect(chunks[2]!.tokens[0]).toBe('w14')
    expect(chunks[3]!.tokens[0]).toBe('w21')
  })

  it('covers every token of an oversized paragraph across its windows', () => {
    const source = paragraphOfWords(25)
    const chunks = chunk(source, { path: '/notes.md', maxTokens: 10, overlap: 3 })
    const covered = new Set(chunks.flatMap((c) => c.tokens))
    expect([...tokenize(source)].every((token) => covered.has(token))).toBe(true)
  })

  it('slices window text out of the original paragraph', () => {
    const source = paragraphOfWords(25)
    const chunks = chunk(source, { path: '/notes.md', maxTokens: 10, overlap: 3 })
    for (const piece of chunks) {
      expect(source).toContain(piece.text)
    }
  })

  it('assigns a contiguous zero-based index across paragraphs and windows', () => {
    const text = `${paragraphOfWords(25, 'a')}\n\nshort tail paragraph`
    const chunks = chunk(text, { path: '/notes.md', maxTokens: 10, overlap: 3 })
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i))
  })

  it('windows CJK paragraphs too', () => {
    // 60 Han characters -> 59 bigram tokens, over a budget of 10.
    const source = '检索算法分块重叠窗口'.repeat(6)
    const chunks = chunk(source, { path: '/cjk.md', maxTokens: 10, overlap: 3 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const piece of chunks) {
      expect(source).toContain(piece.text)
    }
  })

  it('is deterministic: the same input twice yields identical output', () => {
    const text = readFixture('references', 'distributed-systems-notes.md')
    const options = { path: '/distributed-systems-notes.md', maxTokens: 40, overlap: 8 }
    expect(chunk(text, options)).toEqual(chunk(text, options))
  })

  it('produces no chunks for text with no tokens', () => {
    expect(chunk('', { path: '/empty.md' })).toEqual([])
    expect(chunk('\n\n  \n\n --- \n\n', { path: '/empty.md' })).toEqual([])
  })

  it('rejects sizing that cannot make progress', () => {
    expect(() => chunk('x', { path: '/n.md', maxTokens: 10, overlap: 10 })).toThrow(/overlap/)
    expect(() => chunk('x', { path: '/n.md', maxTokens: 10, overlap: 11 })).toThrow(/overlap/)
    expect(() => chunk('x', { path: '/n.md', maxTokens: 0 })).toThrow(/maxTokens/)
    expect(() => chunk('x', { path: '/n.md', overlap: -1 })).toThrow(/overlap/)
  })
})

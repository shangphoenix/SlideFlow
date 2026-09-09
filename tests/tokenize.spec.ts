import { describe, expect, it } from 'vitest'

import { tokenize, tokenizeWithSpans } from '../src/retrieval/tokenize.ts'

describe('tokenize', () => {
  it('splits Latin text on non-word characters and lowercases', () => {
    expect(tokenize('BM25 ranks documents, quickly!')).toEqual([
      'bm25',
      'ranks',
      'documents',
      'quickly',
    ])
  })

  it('treats punctuation, whitespace and symbols as separators', () => {
    expect(tokenize('  a—b\n\tc.d/e  ')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('emits overlapping character bigrams for a run of Han characters', () => {
    // 检索算法 -> 检索, 索算, 算法
    expect(tokenize('检索算法')).toEqual(['检索', '索算', '算法'])
  })

  it('emits a lone Han character as a single token', () => {
    expect(tokenize('查 询')).toEqual(['查', '询'])
  })

  it('separates Han runs from adjacent Latin runs', () => {
    // The Latin/Han boundary is a token boundary even without whitespace.
    expect(tokenize('BM25检索')).toEqual(['bm25', '检索'])
    expect(tokenize('检索BM25')).toEqual(['检索', 'bm25'])
  })

  it('returns no tokens for text with no word characters', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ---  !!! ')).toEqual([])
  })

  it('is idempotent under repeated calls', () => {
    const text = 'Hybrid logical clocks 混合逻辑时钟 keep causality.'
    expect(tokenize(text)).toEqual(tokenize(text))
  })
})

describe('tokenizeWithSpans', () => {
  it('reports spans that slice back to the token for Latin runs', () => {
    const text = 'alpha beta gamma'
    for (const span of tokenizeWithSpans(text)) {
      expect(text.slice(span.start, span.end).toLowerCase()).toBe(span.token)
    }
  })

  it('reports overlapping spans for Han bigrams that slice back to the token', () => {
    const text = '检索算法'
    const spans = tokenizeWithSpans(text)
    expect(spans).toHaveLength(3)
    for (const span of spans) {
      expect(text.slice(span.start, span.end)).toBe(span.token)
    }
    // Consecutive bigrams share one character, so their spans overlap by one.
    expect(spans[1]!.start).toBe(spans[0]!.start + 1)
  })

  it('produces spans in strictly non-decreasing source order', () => {
    const spans = tokenizeWithSpans('one 两个 three 四个五 six')
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.start)
    }
  })

  it('agrees with tokenize()', () => {
    const text = 'Backpressure 背压机制 bounds the queue.'
    expect(tokenizeWithSpans(text).map((span) => span.token)).toEqual(tokenize(text))
  })
})

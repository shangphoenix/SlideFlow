import { describe, expect, it } from 'vitest'

import { bm25Score } from '../src/retrieval/bm25.ts'
import { chunk } from '../src/retrieval/chunk.ts'
import { tokenize } from '../src/retrieval/tokenize.ts'
import type { Chunk } from '../src/types.ts'
import { readFixture } from './helpers.ts'

/** Build a chunk directly from tokens, so hand-computed tests control document length exactly. */
function chunkOf(index: number, tokens: string[]): Chunk {
  return { path: '/synthetic.md', index, text: tokens.join(' '), tokens }
}

const EPSILON = 1e-9

describe('bm25Score — hand-computed correctness', () => {
  // Three documents of equal length 3, so avgdl = 3 and the length-normalisation
  // factor is exactly 1 for every document. That isolates the tf/idf arithmetic.
  const corpus = [
    chunkOf(0, ['bm25', 'ranks', 'documents']),
    chunkOf(1, ['bm25', 'bm25', 'embeddings']),
    chunkOf(2, ['vector', 'database', 'embeddings']),
  ]

  it('matches a score computed by hand from the Okapi BM25 formula', () => {
    // N = 3, df(bm25) = 2  ->  idf = ln(1 + (3 - 2 + 0.5) / (2 + 0.5)) = ln(1.6)
    const idf = Math.log(1.6)

    // k1 = 1.5, b = 0.75, |D| = avgdl = 3
    //   norm = k1 * (1 - b + b * |D|/avgdl) = 1.5 * (0.25 + 0.75) = 1.5
    // doc 0: f = 1 -> 1 * 2.5 / (1 + 1.5)       = 1
    // doc 1: f = 2 -> 2 * 2.5 / (2 + 1.5)       = 10/7
    // doc 2: f = 0 -> no contribution           = 0
    const expected = new Map([
      [0, idf * 1],
      [1, idf * (10 / 7)],
      [2, 0],
    ])

    const scored = bm25Score(corpus, ['bm25'])

    expect(scored).toHaveLength(3)
    for (const result of scored) {
      expect(result.score).toBeCloseTo(expected.get(result.index)!, 12)
    }

    // Spot-check the absolute magnitudes so a sign or base error cannot hide.
    const byIndex = new Map(scored.map((s) => [s.index, s.score]))
    expect(byIndex.get(0)!).toBeCloseTo(0.470003629245736, 12)
    expect(byIndex.get(1)!).toBeCloseTo(0.671433756065337, 12)
  })

  it('sums independent contributions across multiple query terms', () => {
    // Both terms appear in exactly one document, so idf is identical for each:
    //   df = 1 -> ln(1 + (3 - 1 + 0.5)/(1 + 0.5)) = ln(1 + 5/3)
    const idf = Math.log(1 + 5 / 3)
    // Doc 2 contains both 'vector' and 'database', each once, norm = 1.5:
    //   contribution per term = 1 * 2.5 / (1 + 1.5) = 1
    const scored = bm25Score(corpus, ['vector', 'database'])
    const byIndex = new Map(scored.map((s) => [s.index, s.score]))

    expect(byIndex.get(2)!).toBeCloseTo(2 * idf, 12)
    expect(byIndex.get(0)!).toBeCloseTo(0, 12)
    expect(byIndex.get(1)!).toBeCloseTo(0, 12)
  })

  it('counts a repeated query term only once', () => {
    const once = bm25Score(corpus, ['bm25'])
    const thrice = bm25Score(corpus, ['bm25', 'bm25', 'bm25'])
    expect(thrice.map((s) => s.score)).toEqual(once.map((s) => s.score))
  })

  it('ranks a higher term frequency above a lower one at equal length', () => {
    const scored = bm25Score(corpus, ['bm25'])
    expect(scored.map((s) => s.index)).toEqual([1, 0, 2])
  })
})

describe('bm25Score — parameter sensitivity', () => {
  // Deliberately unequal lengths so `b` has something to normalise.
  // avgdl = (2 + 10 + 6) / 3 = 6
  const short = chunkOf(0, ['x', 'a'])
  const long = chunkOf(1, ['x', 'x', ...Array.from({ length: 8 }, (_, i) => `f${i}`)])
  const other = chunkOf(2, Array.from({ length: 6 }, (_, i) => `g${i}`))
  const corpus = [short, long, other]

  it('changes ranking order when b is overridden', () => {
    // b = 0.75: length normalisation penalises the long document enough that the
    //   short single-occurrence document wins.
    //   short: norm = 1.5*(0.25 + 0.75*2/6) = 0.75 -> 1*2.5/(1+0.75)  = 10/7  ≈ 1.4286
    //   long:  norm = 1.5*(0.25 + 0.75*10/6) = 2.25 -> 2*2.5/(2+2.25) = 20/17 ≈ 1.1765
    const normalised = bm25Score(corpus, ['x'], { k1: 1.5, b: 0.75 })
    expect(normalised.map((s) => s.index)).toEqual([0, 1, 2])

    // b = 0: normalisation off, so raw term frequency decides and the order flips.
    //   both: norm = 1.5 -> short 1*2.5/2.5 = 1, long 2*2.5/3.5 = 10/7 ≈ 1.4286
    const unnormalised = bm25Score(corpus, ['x'], { k1: 1.5, b: 0 })
    expect(unnormalised.map((s) => s.index)).toEqual([1, 0, 2])
  })

  it('matches hand-computed scores for the overridden b values', () => {
    const idf = Math.log(1 + (3 - 2 + 0.5) / (2 + 0.5)) // ln(1.6)

    const normalised = new Map(bm25Score(corpus, ['x'], { k1: 1.5, b: 0.75 }).map((s) => [s.index, s.score]))
    expect(normalised.get(0)!).toBeCloseTo(idf * (10 / 7), 12)
    expect(normalised.get(1)!).toBeCloseTo(idf * (20 / 17), 12)

    const unnormalised = new Map(bm25Score(corpus, ['x'], { k1: 1.5, b: 0 }).map((s) => [s.index, s.score]))
    expect(unnormalised.get(0)!).toBeCloseTo(idf * 1, 12)
    expect(unnormalised.get(1)!).toBeCloseTo(idf * (10 / 7), 12)
  })

  it('widens the gap in favour of a repeated term as k1 grows', () => {
    // k1 controls term-frequency saturation: a larger k1 saturates later, so the
    // two-occurrence document gains relative to the one-occurrence document.
    // b = 0 isolates this from length normalisation.
    const ratioAt = (k1: number): number => {
      const scores = new Map(bm25Score(corpus, ['x'], { k1, b: 0 }).map((s) => [s.index, s.score]))
      return scores.get(1)! / scores.get(0)!
    }

    expect(ratioAt(0.1)).toBeLessThan(ratioAt(1.5))
    expect(ratioAt(1.5)).toBeLessThan(ratioAt(5))
    // Hand-check one of them: k1 = 5 -> short 1*6/(1+5) = 1, long 2*6/(2+5) = 12/7
    expect(ratioAt(5)).toBeCloseTo(12 / 7, 12)
  })

  it('uses the documented defaults when params are omitted', () => {
    expect(bm25Score(corpus, ['x']).map((s) => s.score)).toEqual(
      bm25Score(corpus, ['x'], { k1: 1.5, b: 0.75 }).map((s) => s.score),
    )
  })
})

describe('bm25Score — edge cases', () => {
  const corpus = [chunkOf(0, ['alpha', 'beta']), chunkOf(1, ['gamma'])]

  it('returns an empty array for an empty corpus without throwing', () => {
    expect(bm25Score([], ['anything'])).toEqual([])
  })

  it('scores every document zero for an empty query without throwing', () => {
    const scored = bm25Score(corpus, [])
    expect(scored).toHaveLength(2)
    expect(scored.every((s) => s.score === 0)).toBe(true)
  })

  it('scores every document zero when no query term matches', () => {
    const scored = bm25Score(corpus, ['nothing', 'matches', 'here'])
    expect(scored.every((s) => s.score === 0)).toBe(true)
  })

  it('does not divide by zero when every document is empty', () => {
    const empty = [chunkOf(0, []), chunkOf(1, [])]
    const scored = bm25Score(empty, ['x'])
    expect(scored.every((s) => Number.isFinite(s.score))).toBe(true)
  })

  it('keeps corpus order for tied scores', () => {
    const tied = [chunkOf(0, ['x']), chunkOf(1, ['x']), chunkOf(2, ['x'])]
    expect(bm25Score(tied, ['x']).map((s) => s.index)).toEqual([0, 1, 2])
  })

  it('preserves every chunk field alongside the score', () => {
    const [top] = bm25Score(corpus, ['alpha'])
    expect(top).toMatchObject({ path: '/synthetic.md', index: 0, text: 'alpha beta' })
    expect(top!.tokens).toEqual(['alpha', 'beta'])
  })
})

describe('bm25Score — end to end over real reference fixtures', () => {
  const documents = [
    ['react-hooks-notes.md', readFixture('references', 'react-hooks-notes.md')],
    ['distributed-systems-notes.md', readFixture('references', 'distributed-systems-notes.md')],
    ['llm-agents-notes.md', readFixture('references', 'llm-agents-notes.md')],
  ] as const

  const corpus = documents.flatMap(([name, text]) => chunk(text, { path: `/${name}`, maxTokens: 80, overlap: 16 }))

  it('surfaces the topically correct document for a distinctive query', () => {
    const [top] = bm25Score(corpus, tokenize('useEffect dependency array cleanup'))
    expect(top!.path).toBe('/react-hooks-notes.md')
  })

  it('discriminates between the three fixture topics', () => {
    const cases: Array<[string, string]> = [
      ['raft leader election quorum', '/distributed-systems-notes.md'],
      ['agent loop tool definitions json schema', '/llm-agents-notes.md'],
      ['memoisation useMemo useCallback', '/react-hooks-notes.md'],
    ]
    for (const [query, expectedPath] of cases) {
      const [top] = bm25Score(corpus, tokenize(query))
      expect(top!.path, `query: ${query}`).toBe(expectedPath)
    }
  })

  it('returns results sorted by descending score', () => {
    const scored = bm25Score(corpus, tokenize('retrieval bm25 embeddings'))
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1]!.score).toBeGreaterThanOrEqual(scored[i]!.score)
    }
  })
})

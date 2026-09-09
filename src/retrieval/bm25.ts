/**
 * Okapi BM25 ranking.
 *
 * The corpus is whatever chunks the caller passes in — there is no persisted
 * index and no state between calls. IDF is therefore computed fresh over that
 * set on every call, which is exactly right for SlideFlow: a search is scoped
 * to the handful of reference documents the user named for *this* deck.
 *
 *   score(D, Q) = Σ_{q ∈ Q} idf(q) · ( f(q,D) · (k1 + 1) )
 *                            / ( f(q,D) + k1 · (1 - b + b · |D| / avgdl) )
 *
 *   idf(q) = ln( 1 + (N - n(q) + 0.5) / (n(q) + 0.5) )
 *
 * The `1 +` inside the log is the standard smoothing that keeps IDF
 * non-negative for terms appearing in more than half the corpus.
 */

import type { Chunk, ScoredChunk } from '../types.ts'

/** BM25 free parameters. */
export interface Bm25Params {
  /** Term-frequency saturation. */
  k1?: number
  /** Length normalisation, 0 (off) to 1 (full). */
  b?: number
}

export const DEFAULT_K1 = 1.5
export const DEFAULT_B = 0.75

/**
 * Score every chunk against a tokenised query.
 *
 * @param chunks - the corpus for this query; scoring is relative to this set alone.
 * @param queryTokens - query tokens, already produced by `tokenize()`.
 * @param params - optional `k1`/`b` overrides.
 * @returns every chunk with a `score`, sorted by score descending; ties keep
 *   corpus order, so the result is deterministic.
 */
export function bm25Score(
  chunks: Chunk[],
  queryTokens: string[],
  params: Bm25Params = {},
): ScoredChunk[] {
  const k1 = params.k1 ?? DEFAULT_K1
  const b = params.b ?? DEFAULT_B

  const n = chunks.length
  if (n === 0) return []

  const lengths = chunks.map((c) => c.tokens.length)
  const totalLength = lengths.reduce((sum, length) => sum + length, 0)
  // An all-empty corpus would divide by zero; treat avgdl as 1, which makes
  // the length-normalisation factor a no-op for the (also empty) documents.
  const avgdl = totalLength === 0 ? 1 : totalLength / n

  // Term frequency per chunk, computed once and reused for every query term.
  const frequencies = chunks.map((c) => {
    const counts = new Map<string, number>()
    for (const token of c.tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    return counts
  })

  const uniqueQueryTokens = [...new Set(queryTokens)]

  // Inverse document frequency per query term.
  const idf = new Map<string, number>()
  for (const term of uniqueQueryTokens) {
    let documentFrequency = 0
    for (const counts of frequencies) if (counts.has(term)) documentFrequency += 1
    idf.set(term, Math.log(1 + (n - documentFrequency + 0.5) / (documentFrequency + 0.5)))
  }

  const scored = chunks.map((c, i) => {
    const counts = frequencies[i]!
    const docLength = lengths[i]!
    const norm = k1 * (1 - b + (b * docLength) / avgdl)

    let score = 0
    for (const term of uniqueQueryTokens) {
      const frequency = counts.get(term)
      if (frequency === undefined) continue
      score += idf.get(term)! * ((frequency * (k1 + 1)) / (frequency + norm))
    }
    return { ...c, score }
  })

  // Stable sort by score descending. Array.prototype.sort is stable per spec,
  // so equal scores retain corpus order.
  return scored.sort((left, right) => right.score - left.score)
}

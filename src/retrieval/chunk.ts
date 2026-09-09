/**
 * Splitting reference documents into retrievable passages.
 *
 * Paragraphs are the natural unit: they are author-chosen semantic boundaries
 * and they are free. A paragraph that fits within `maxTokens` becomes one
 * chunk verbatim. Only an oversized paragraph is windowed, and those windows
 * overlap so a phrase straddling a window boundary is still fully present in
 * one of them.
 */

import type { Chunk } from '../types.ts'
import { tokenizeWithSpans } from './tokenize.ts'

/** Options for {@link chunk}. */
export interface ChunkOptions {
  /** Source document path, copied onto every produced chunk. */
  path: string
  /** Maximum tokens per chunk. */
  maxTokens?: number
  /** Tokens shared between consecutive windows of one oversized paragraph. */
  overlap?: number
}

export const DEFAULT_MAX_TOKENS = 150
export const DEFAULT_OVERLAP = 30

/** Blank-line paragraph boundary. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/

/**
 * Split text into chunks on paragraph boundaries, windowing oversized paragraphs.
 *
 * Deterministic: the same input always yields the same chunks.
 *
 * @param text - full document text.
 * @param options - source path plus optional sizing.
 * @returns chunks in document order, each with a corpus-unique `index`.
 * @throws if `maxTokens` is not positive or `overlap` is not strictly smaller.
 */
export function chunk(text: string, options: ChunkOptions): Chunk[] {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
  const overlap = options.overlap ?? DEFAULT_OVERLAP

  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new RangeError(`maxTokens must be a positive integer, received ${maxTokens}`)
  }
  if (!Number.isInteger(overlap) || overlap < 0) {
    throw new RangeError(`overlap must be a non-negative integer, received ${overlap}`)
  }
  if (overlap >= maxTokens) {
    throw new RangeError(
      `overlap (${overlap}) must be smaller than maxTokens (${maxTokens}), otherwise windowing cannot advance`,
    )
  }

  const chunks: Chunk[] = []
  const push = (chunkText: string, tokens: string[]): void => {
    chunks.push({ path: options.path, index: chunks.length, text: chunkText, tokens })
  }

  for (const rawParagraph of text.split(PARAGRAPH_BREAK)) {
    const paragraph = rawParagraph.trim()
    if (paragraph.length === 0) continue

    const spans = tokenizeWithSpans(paragraph)
    if (spans.length === 0) continue

    if (spans.length <= maxTokens) {
      push(
        paragraph,
        spans.map((span) => span.token),
      )
      continue
    }

    const step = maxTokens - overlap
    for (let start = 0; start < spans.length; start += step) {
      const window = spans.slice(start, start + maxTokens)
      const first = window[0]!
      const last = window[window.length - 1]!
      push(
        paragraph.slice(first.start, last.end),
        window.map((span) => span.token),
      )
      // The final window is the one that reaches the end; stop rather than
      // emitting ever-shorter tails that add no new tokens.
      if (start + maxTokens >= spans.length) break
    }
  }

  return chunks
}

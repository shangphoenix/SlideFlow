/**
 * Tokenisation for the BM25 index.
 *
 * Two scripts are handled differently because they carry word boundaries
 * differently:
 *
 * - Latin (and any other script that spaces its words): each maximal run of
 *   letters/digits becomes one lowercased token.
 * - Han (Chinese): there are no spaces between words, so a run of Han
 *   characters is emitted as overlapping character *bigrams*. Bigrams are a
 *   deliberately cheap stand-in for real segmentation — see DECISIONS.md.
 *
 * Everything else (punctuation, whitespace, symbols) is a separator.
 */

const HAN = /\p{Script=Han}/u
const WORD = /[\p{L}\p{N}]/u

/** One token plus its half-open `[start, end)` span in the source string. */
export interface TokenSpan {
  token: string
  start: number
  end: number
}

/**
 * Tokenise text, keeping each token's source span.
 *
 * Spans let `chunk()` window a long paragraph by token count and still slice
 * out the exact original text. Han bigram spans deliberately overlap, matching
 * the overlap of the bigrams themselves.
 *
 * @param text - raw source text.
 * @returns tokens in source order, each with its span.
 */
export function tokenizeWithSpans(text: string): TokenSpan[] {
  const spans: TokenSpan[] = []

  /** Buffered Han characters as `[char, startOffset]` pairs. */
  let han: Array<[string, number]> = []
  /** Buffered Latin-ish characters, plus the offset the run started at. */
  let word = ''
  let wordStart = 0

  const flushHan = (): void => {
    if (han.length === 1) {
      const [char, start] = han[0]!
      spans.push({ token: char, start, end: start + char.length })
    } else {
      for (let i = 0; i + 1 < han.length; i++) {
        const [first, start] = han[i]!
        const [second] = han[i + 1]!
        spans.push({ token: first + second, start, end: start + first.length + second.length })
      }
    }
    han = []
  }

  const flushWord = (): void => {
    if (word.length > 0) {
      spans.push({ token: word.toLowerCase(), start: wordStart, end: wordStart + word.length })
      word = ''
    }
  }

  // Iterate by code point so astral characters are never split mid-token.
  let offset = 0
  for (const char of text) {
    if (HAN.test(char)) {
      flushWord()
      han.push([char, offset])
    } else if (WORD.test(char)) {
      if (han.length > 0) flushHan()
      if (word.length === 0) wordStart = offset
      word += char
    } else {
      if (han.length > 0) flushHan()
      flushWord()
    }
    offset += char.length
  }
  if (han.length > 0) flushHan()
  flushWord()

  return spans
}

/**
 * Tokenise text for indexing or querying.
 *
 * @param text - raw source text.
 * @returns tokens in source order.
 */
export function tokenize(text: string): string[] {
  return tokenizeWithSpans(text).map((span) => span.token)
}

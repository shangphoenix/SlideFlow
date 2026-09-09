/**
 * Shared domain types for SlideFlow.
 *
 * These describe the two model-produced artifacts (outline, script) and the
 * intermediate values used by the deterministic retrieval pipeline. The JSON
 * Schemas in `src/schemas` are the runtime authority for the first two; these
 * types are the compile-time mirror.
 */

/** One slide in a generated outline. */
export interface Slide {
  /** Slide title, rendered as an `##` heading. */
  heading: string
  /** Bullet points, rendered as a markdown list. */
  key_points: string[]
  /** Free-form hint carried forward to guide speaker-script generation. */
  notes_hint: string
}

/** A complete deck outline: the artifact confirmed at the first human gate. */
export interface Outline {
  title: string
  slides: Slide[]
}

/** The speaker script for a single slide. */
export interface ScriptEntry {
  /** Must match the corresponding outline slide heading exactly. */
  heading: string
  script_text: string
}

/** A complete speaker script: the artifact confirmed at the second human gate. */
export type Script = ScriptEntry[]

/** One retrievable passage extracted from a reference document. */
export interface Chunk {
  /** Source document path, as supplied to `search_reference`. */
  path: string
  /** Zero-based position of this chunk within the whole search corpus. */
  index: number
  /** Verbatim source text for this chunk. */
  text: string
  /** Tokens produced by `tokenize(text)`, cached so BM25 need not re-tokenize. */
  tokens: string[]
}

/** A chunk with its BM25 relevance score for one particular query. */
export interface ScoredChunk extends Chunk {
  score: number
}

/** Result of validating a model-produced candidate against its schema. */
export interface ValidationResult {
  valid: boolean
  /** Human-readable violations, empty when `valid` is true. */
  errors: string[]
}

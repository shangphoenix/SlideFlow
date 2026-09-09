/** Plugin configuration and its defaults. */

/** BM25 ranking parameters. */
export interface Bm25Config {
  /** Term-frequency saturation. Higher values reward repeated terms more. */
  k1?: number
  /** Length normalisation, 0 (off) to 1 (full). */
  b?: number
}

/**
 * User-facing plugin config, as written under `config:` in `cordis.yml`.
 * Every field is optional; see {@link resolveConfig} for the defaults.
 */
export interface Config {
  /**
   * `serverName` of the mcp-client plugin instance that bridges the reference
   * document filesystem. `search_reference` calls
   * `mcp__<mcpServerName>__read_text_file`.
   */
  mcpServerName?: string
  /** Number of passages `search_reference` returns when the model omits `top_k`. */
  defaultTopK?: number
  bm25?: Bm25Config
  /** Directory `render_slides` writes into when the model omits `output_dir`. */
  outputDir?: string
}

/** Config with every default applied. Internal code only ever sees this shape. */
export interface ResolvedConfig {
  mcpServerName: string
  defaultTopK: number
  bm25: Required<Bm25Config>
  outputDir: string
}

/** Defaults, exported so the README and tests cannot drift from the code. */
export const DEFAULT_CONFIG: ResolvedConfig = {
  mcpServerName: 'filesystem',
  defaultTopK: 5,
  bm25: { k1: 1.5, b: 0.75 },
  outputDir: process.cwd(),
}

/**
 * Apply defaults to a partial config.
 *
 * `outputDir` defaults to the *current* `process.cwd()` rather than the value
 * captured in {@link DEFAULT_CONFIG} at module load, so the plugin behaves
 * predictably if the harness changes directory before `apply()` runs.
 *
 * @param config - partial config from `cordis.yml`, or nothing.
 * @returns a fully populated config.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  return {
    mcpServerName: config.mcpServerName ?? DEFAULT_CONFIG.mcpServerName,
    defaultTopK: config.defaultTopK ?? DEFAULT_CONFIG.defaultTopK,
    bm25: {
      k1: config.bm25?.k1 ?? DEFAULT_CONFIG.bm25.k1,
      b: config.bm25?.b ?? DEFAULT_CONFIG.bm25.b,
    },
    outputDir: config.outputDir ?? process.cwd(),
  }
}

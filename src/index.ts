/**
 * SlideFlow — a DeepSeek Harness plugin that turns a topic plus reference
 * documents into a confirmed outline, a per-slide speaker script, and a
 * rendered Marp deck.
 *
 * The plugin registers four native tools and one skill provider. The tools
 * hold every deterministic behaviour — retrieval, validation, rendering. The
 * three skills are Markdown instructions that tell the agent when to call
 * those tools, and where the two human confirmation gates sit. Nothing in this
 * package generates outline or script *content*; that is the model's work at
 * runtime.
 *
 * @module slideflow
 */

import type { Context } from '@deepseek-ai/cordis'

import { type Config, resolveConfig } from './config.ts'
import { createSlideflowSkillProvider } from './skills/provider.ts'
import { registerRenderSlidesTool } from './tools/render-slides.ts'
import { registerSearchReferenceTool } from './tools/search-reference.ts'
import { registerValidateOutlineTool } from './tools/validate-outline.ts'
import { registerValidateScriptTool } from './tools/validate-script.ts'

/** Cordis plugin name. */
export const name = 'slideflow'

/**
 * Services this plugin needs before it can load.
 *
 * `tools` and `skills` are both hard requirements — every registration below
 * goes through one of them. Note that the mcp-client instance backing
 * `search_reference` is *not* injected: it contributes a bridged tool to the
 * same `tools` registry, and `search_reference` resolves that tool by name at
 * call time rather than at load time. That keeps SlideFlow loadable without a
 * configured MCP server, at the cost of a clear runtime error if the user
 * searches references without one.
 */
export const inject = ['tools', 'skills']

/**
 * Apply the plugin.
 *
 * @param ctx - the Cordis context, with `tools` and `skills` injected.
 * @param config - plugin config from `cordis.yml`; every field is optional.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  registerSearchReferenceTool(ctx, resolved)
  registerValidateOutlineTool(ctx)
  registerValidateScriptTool(ctx)
  registerRenderSlidesTool(ctx, resolved)

  ctx.skills.registerProvider(() => createSlideflowSkillProvider())
}

export type { Config, ResolvedConfig, Bm25Config } from './config.ts'
export { resolveConfig, DEFAULT_CONFIG } from './config.ts'
export type { Outline, Slide, Script, ScriptEntry, Chunk, ScoredChunk, ValidationResult } from './types.ts'
export { validateOutline, validateScript } from './schemas/validate.ts'
export { outlineSchema } from './schemas/outline.schema.ts'
export { scriptSchema } from './schemas/script.schema.ts'
export { tokenize } from './retrieval/tokenize.ts'
export { chunk } from './retrieval/chunk.ts'
export { bm25Score } from './retrieval/bm25.ts'
export { outlineAndScriptToMarp } from './render/to-marp-markdown.ts'
export { renderHtml } from './render/render-html.ts'
export { createSlideflowSkillProvider, CANDIDATES } from './skills/provider.ts'

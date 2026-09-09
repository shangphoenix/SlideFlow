/**
 * `search_reference` — BM25 retrieval over user-supplied reference documents.
 *
 * The interesting part is where the *bytes* come from. This tool never touches
 * the filesystem itself. It re-enters the harness's own tool pipeline via
 * `ctx.tools.execute()` to call the MCP-bridged `read_text_file` tool exposed
 * by an external MCP filesystem server. That server is launched with an
 * explicit allowed-directory argument, so the sandboxing of untrusted
 * reference material is enforced by the MCP server, outside this process,
 * rather than by a path check we would have to get right ourselves.
 *
 * Ranking is deterministic and stateless: chunk, score, sort, slice. No index
 * is persisted between calls.
 */

import { randomUUID } from 'node:crypto'

import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'

import type { ResolvedConfig } from '../config.ts'
import type { Chunk } from '../types.ts'
import { bm25Score } from '../retrieval/bm25.ts'
import { chunk } from '../retrieval/chunk.ts'
import { tokenize } from '../retrieval/tokenize.ts'

/**
 * Build the bridged tool name for a given mcp-client instance.
 *
 * dsh's mcp-client plugin namespaces every bridged tool as
 * `mcp__<serverName>__<remoteToolName>`.
 *
 * @param mcpServerName - the `serverName` configured on the mcp-client instance.
 * @returns the fully qualified bridged tool name.
 */
export function readTextFileToolName(mcpServerName: string): string {
  return `mcp__${mcpServerName}__read_text_file`
}

/**
 * Register `search_reference` on a context.
 *
 * @param ctx - the plugin context; must have the `tools` service injected.
 * @param config - resolved plugin config.
 * @returns the disposer returned by `ctx.tools.register`.
 */
export function registerSearchReferenceTool(ctx: Context, config: ResolvedConfig): () => void {
  const toolName = readTextFileToolName(config.mcpServerName)

  const searchReference = defineTool({
    name: 'search_reference',
    description:
      'Search the user-supplied reference documents for passages relevant to a query, ' +
      'using BM25 keyword ranking. Call this before drafting an outline whenever the ' +
      'user has provided reference material, and quote or paraphrase the returned ' +
      'passages rather than relying on memory. Files are read through the configured ' +
      'MCP filesystem server, so only paths inside its allowed directory can be read.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Natural-language query or keywords describing what to look for.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description:
          'Absolute paths of reference documents to search, as given by the user. ' +
          'Each must lie inside the MCP filesystem server\'s allowed directory.',
      },
      top_k: {
        type: 'integer',
        description: `How many passages to return. Defaults to ${config.defaultTopK}.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          total_chunks: {
            type: 'integer',
            required: true,
            description: 'How many passages were searched across all documents.',
          },
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                index: { type: 'integer', required: true },
                score: { type: 'number', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render(_args, value) {
        if (value.results.length === 0) {
          return [
            {
              type: 'text',
              text:
                `No passages matched "${value.query}" across ${value.total_chunks} searched passages. ` +
                'Try broader or different keywords, or proceed without reference material.',
            },
          ]
        }
        const body = value.results
          .map(
            (result, rank) =>
              `[${rank + 1}] ${result.path} (passage ${result.index}, score ${result.score.toFixed(3)})\n${result.text}`,
          )
          .join('\n\n')
        return [
          {
            type: 'text',
            text: `Top ${value.results.length} of ${value.total_chunks} passages for "${value.query}":\n\n${body}`,
          },
        ]
      },
    },
    async execute(args, exec) {
      const topK = args.top_k ?? config.defaultTopK
      if (topK < 1) {
        throw new Error(`top_k must be at least 1, received ${topK}`)
      }
      if (args.paths.length === 0) {
        throw new Error('paths must name at least one reference document to search')
      }

      const chunks: Chunk[] = []
      for (const path of args.paths) {
        const text = await readReferenceFile(ctx, toolName, path, exec)
        // Re-index into a single corpus so `index` is unique across documents.
        for (const piece of chunk(text, { path })) {
          chunks.push({ ...piece, index: chunks.length })
        }
      }

      const ranked = bm25Score(chunks, tokenize(args.query), config.bm25)

      return {
        query: args.query,
        total_chunks: chunks.length,
        results: ranked.slice(0, topK).map((result) => ({
          path: result.path,
          index: result.index,
          score: result.score,
          text: result.text,
        })),
      }
    },
  })

  return ctx.tools.register(searchReference)
}

/**
 * Read one reference document through the MCP-bridged filesystem tool.
 *
 * The nested call carries this execution's `rootCallId`, `parent` token, and
 * `agent` so the harness can attribute it to the originating model turn — a
 * bare call without a parent is rejected outright when the harness is running
 * in program-tool-calling mode.
 *
 * @param ctx - plugin context.
 * @param toolName - the bridged `mcp__<server>__read_text_file` name.
 * @param path - absolute path to read.
 * @param exec - the enclosing execution, for cancellation and call attribution.
 * @returns the document's text content.
 * @throws if the bridged tool is unavailable or the read failed.
 */
async function readReferenceFile(
  ctx: Context,
  toolName: string,
  path: string,
  exec: ToolRunContext,
): Promise<string> {
  const result = await ctx.tools.execute({
    callId: ToolCallId(randomUUID()),
    rootCallId: exec.rootCallId,
    parent: exec.token,
    name: toolName,
    arguments: { path },
    signal: exec.signal,
    ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
  })

  const text = result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')

  if (result.isError) {
    throw new Error(
      `Could not read reference file "${path}" via "${toolName}": ${text || 'the tool reported an error'}. ` +
        'Check that the mcp-client plugin is configured and that the path is inside its allowed directory.',
    )
  }
  if (text.trim().length === 0) {
    throw new Error(`Reference file "${path}" was read successfully but contained no text.`)
  }

  return text
}

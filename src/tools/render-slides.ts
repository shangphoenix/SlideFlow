/**
 * `render_slides` — write the finished deck to disk.
 *
 * Two deliberate choices worth defending:
 *
 * 1. It re-validates both artifacts in-process before writing anything. The
 *    skills instruct the model to validate first, but instructions are not
 *    enforcement: this is the last point where a malformed artifact can be
 *    stopped, and it is cheap.
 * 2. It writes with `node:fs`, not the MCP filesystem server's `write_file`.
 *    The MCP boundary exists to sandbox reads of *untrusted reference
 *    material*; the plugin's own output is neither untrusted nor
 *    reference material, and routing it through MCP would force the server's
 *    allowed directory to also be the user's output directory. See DECISIONS.md.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'

import type { ResolvedConfig } from '../config.ts'
import type { Outline, ScriptEntry } from '../types.ts'
import { validateOutline, validateScript } from '../schemas/validate.ts'
import { outlineAndScriptToMarp } from '../render/to-marp-markdown.ts'
import { renderHtml } from '../render/render-html.ts'

export const MARKDOWN_FILENAME = 'slides.md'
export const HTML_FILENAME = 'slides.html'

/**
 * Register `render_slides` on a context.
 *
 * @param ctx - the plugin context; must have the `tools` service injected.
 * @param config - resolved plugin config, supplying the default output directory.
 * @returns the disposer returned by `ctx.tools.register`.
 */
export function registerRenderSlidesTool(ctx: Context, config: ResolvedConfig): () => void {
  const tool = defineTool({
    name: 'render_slides',
    description:
      'Render a confirmed outline and speaker script into Marp markdown and a standalone ' +
      'HTML deck, written to disk. Call this only after the user has confirmed both the ' +
      'outline and the script. Both artifacts are re-validated before anything is written.',
    parameters: {
      outline: {
        type: 'json',
        required: true,
        description: 'The user-confirmed outline.',
      },
      script: {
        type: 'json',
        required: true,
        description: 'The user-confirmed speaker script, one entry per outline slide.',
      },
      output_dir: {
        type: 'string',
        description: `Directory to write into. Defaults to ${config.outputDir}.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          markdown_path: { type: 'string', required: true },
          html_path: { type: 'string', required: true },
          slide_count: { type: 'integer', required: true },
        },
      },
      render(_args, value) {
        return [
          {
            type: 'text',
            text:
              `Rendered ${value.slide_count} slide(s):\n` +
              `- Marp markdown: ${value.markdown_path}\n` +
              `- Standalone HTML: ${value.html_path}`,
          },
        ]
      },
    },
    async execute(args) {
      const outlineResult = validateOutline(args.outline)
      if (!outlineResult.valid) {
        throw new Error(
          `Refusing to render: the outline is invalid.\n${outlineResult.errors.map((e) => `- ${e}`).join('\n')}`,
        )
      }

      const scriptResult = validateScript(args.outline, args.script)
      if (!scriptResult.valid) {
        throw new Error(
          `Refusing to render: the script is invalid.\n${scriptResult.errors.map((e) => `- ${e}`).join('\n')}`,
        )
      }

      const outline = args.outline as unknown as Outline
      const script = args.script as unknown as ScriptEntry[]

      const markdown = outlineAndScriptToMarp(outline, script)
      const { html } = renderHtml(markdown, outline.title)

      const directory = resolve(args.output_dir ?? config.outputDir)
      await mkdir(directory, { recursive: true })

      const markdownPath = resolve(directory, MARKDOWN_FILENAME)
      const htmlPath = resolve(directory, HTML_FILENAME)
      await writeFile(markdownPath, markdown, 'utf8')
      await writeFile(htmlPath, html, 'utf8')

      return {
        markdown_path: markdownPath,
        html_path: htmlPath,
        slide_count: outline.slides.length,
      }
    },
  })

  return ctx.tools.register(tool)
}

/**
 * `validate_script` — schema-check a candidate script *and* cross-check it
 * against the confirmed outline.
 *
 * The outline is a required parameter precisely because the interesting
 * failure is relational: a script that is individually well-formed but
 * narrates a different deck. See `validateScript` in `src/schemas/validate.ts`.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'

import { validateScript } from '../schemas/validate.ts'
import { renderValidation, validationOutput } from './validate-outline.ts'

/**
 * Register `validate_script` on a context.
 *
 * @param ctx - the plugin context; must have the `tools` service injected.
 * @returns the disposer returned by `ctx.tools.register`.
 */
export function registerValidateScriptTool(ctx: Context): () => void {
  const tool = defineTool({
    name: 'validate_script',
    description:
      'Check a candidate speaker script against the SlideFlow script JSON Schema, and ' +
      'verify that its headings match the confirmed outline exactly, in order. ' +
      'Call this on every script you draft, before showing it to the user.',
    parameters: {
      outline: {
        type: 'json',
        required: true,
        description: 'The confirmed outline the script must narrate.',
      },
      candidate: {
        type: 'json',
        required: true,
        description: 'The script array to validate, exactly as drafted.',
      },
    },
    output: {
      ...validationOutput,
      render: (_args, value) => renderValidation('script', value),
    },
    execute: (args) => Promise.resolve(validateScript(args.outline, args.candidate)),
  })

  return ctx.tools.register(tool)
}

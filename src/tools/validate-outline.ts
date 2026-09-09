/**
 * `validate_outline` — schema-check a candidate outline.
 *
 * The parameter is declared `type: 'json'` rather than a mirrored object
 * schema. That is deliberate: the candidate's real contract is the outline
 * JSON Schema, enforced by ajv inside the handler. Declaring it twice would
 * give the model two different error vocabularies for the same mistake, and
 * a framework-level argument rejection would deny the model the detailed,
 * field-by-field feedback that makes the retry loop work at all.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'

import { validateOutline } from '../schemas/validate.ts'

/** Shared output declaration for both validator tools. */
export const validationOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      valid: { type: 'boolean', required: true },
      errors: { type: 'array', required: true, items: { type: 'string' } },
    },
  },
} as const

/**
 * Render a validation result as model-facing text.
 *
 * @param label - the artifact kind, for the success message.
 * @param value - the validation result.
 * @returns a single text block.
 */
export function renderValidation(
  label: string,
  value: { valid: boolean; errors: string[] },
): [{ type: 'text'; text: string }] {
  if (value.valid) {
    return [{ type: 'text', text: `The ${label} is valid.` }]
  }
  return [
    {
      type: 'text',
      text:
        `The ${label} is INVALID. ${value.errors.length} problem(s):\n` +
        value.errors.map((error) => `- ${error}`).join('\n'),
    },
  ]
}

/**
 * Register `validate_outline` on a context.
 *
 * @param ctx - the plugin context; must have the `tools` service injected.
 * @returns the disposer returned by `ctx.tools.register`.
 */
export function registerValidateOutlineTool(ctx: Context): () => void {
  const tool = defineTool({
    name: 'validate_outline',
    description:
      'Check a candidate outline against the SlideFlow outline JSON Schema. ' +
      'Call this on every outline you draft, before showing it to the user. ' +
      'If it reports errors, fix exactly those errors and validate again.',
    parameters: {
      candidate: {
        type: 'json',
        required: true,
        description: 'The outline object to validate, exactly as drafted.',
      },
    },
    output: {
      ...validationOutput,
      render: (_args, value) => renderValidation('outline', value),
    },
    execute: (args) => Promise.resolve(validateOutline(args.candidate)),
  })

  return ctx.tools.register(tool)
}

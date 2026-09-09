/**
 * JSON Schema for a speaker script.
 *
 * The script is a bare array, one entry per outline slide, in the same order.
 * That ordering requirement is a cross-document constraint JSON Schema cannot
 * express, so it is enforced in code by `validateScript` — see
 * `src/schemas/validate.ts`.
 */
export const scriptSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'SlideFlow speaker script',
  type: 'array',
  minItems: 1,
  description: 'One entry per outline slide, in outline order.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['heading', 'script_text'],
    properties: {
      heading: {
        type: 'string',
        minLength: 1,
        maxLength: 80,
        description: 'Must exactly match the corresponding outline slide heading.',
      },
      script_text: {
        type: 'string',
        minLength: 1,
        maxLength: 2000,
        description: 'What the presenter says while this slide is shown.',
      },
    },
  },
} as const

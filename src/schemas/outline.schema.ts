/**
 * JSON Schema for a deck outline.
 *
 * Plain data, not a schema-library builder: this object is handed straight to
 * ajv and can also be pasted into a prompt or a bug report unchanged.
 * `additionalProperties: false` at both levels is deliberate — a model that
 * invents an extra field should be told so rather than silently ignored.
 */
export const outlineSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'SlideFlow outline',
  type: 'object',
  additionalProperties: false,
  required: ['title', 'slides'],
  properties: {
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 120,
      description: 'Deck title, rendered as the title slide.',
    },
    slides: {
      type: 'array',
      minItems: 3,
      maxItems: 30,
      description: 'Content slides, in presentation order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'key_points', 'notes_hint'],
        properties: {
          heading: {
            type: 'string',
            minLength: 1,
            maxLength: 80,
            description: 'Slide title. Must be unique enough to identify the slide.',
          },
          key_points: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            description: 'Bullet points shown on the slide.',
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          notes_hint: {
            type: 'string',
            maxLength: 300,
            description: 'Guidance for the speaker script writer. May be empty.',
          },
        },
      },
    },
  },
} as const

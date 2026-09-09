/**
 * Structural validation of model-produced artifacts.
 *
 * These are pure functions over plain values: no context, no I/O, no logging.
 * The `validate_outline` / `validate_script` tools are thin wrappers around
 * them, which is what makes the validation logic directly unit-testable
 * without standing up a harness.
 *
 * Error strings are written to be read by the *model*, not only by a human:
 * they name the failing path and the violated rule, so a retry has something
 * concrete to act on.
 */

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv'

import type { Outline, ValidationResult } from '../types.ts'
import { outlineSchema } from './outline.schema.ts'
import { scriptSchema } from './script.schema.ts'

// `allErrors` so one retry can fix every problem at once instead of
// discovering them one round-trip at a time.
const ajv = new Ajv({ allErrors: true, strict: true })

const validateOutlineSchema: ValidateFunction = ajv.compile(outlineSchema)
const validateScriptSchema: ValidateFunction = ajv.compile(scriptSchema)

/**
 * Render one ajv error as a single self-describing line.
 *
 * ajv's own `message` omits the offending property for `additionalProperties`
 * and `required`, which are the two failures a model most needs named, so both
 * are spliced back in from `params`.
 *
 * @param error - one ajv error object.
 * @returns a `path: message` line.
 */
function formatError(error: ErrorObject): string {
  const path = error.instancePath === '' ? '(root)' : error.instancePath
  const params = error.params as Record<string, unknown>

  if (error.keyword === 'additionalProperties') {
    return `${path}: unknown property "${String(params['additionalProperty'])}" is not allowed`
  }
  if (error.keyword === 'required') {
    return `${path}: missing required property "${String(params['missingProperty'])}"`
  }
  return `${path}: ${error.message ?? 'is invalid'}`
}

/**
 * Collect formatted errors from the last run of a compiled validator.
 *
 * @param validate - the ajv validator that just returned false.
 * @returns one line per violation, never empty.
 */
function collectErrors(validate: ValidateFunction): string[] {
  const errors = (validate.errors ?? []).map(formatError)
  return errors.length > 0 ? errors : ['(root): failed schema validation']
}

/**
 * Validate an outline candidate against the outline schema.
 *
 * @param candidate - anything the model produced, however malformed.
 * @returns `{ valid, errors }`; `errors` is empty exactly when `valid` is true.
 */
export function validateOutline(candidate: unknown): ValidationResult {
  if (validateOutlineSchema(candidate)) return { valid: true, errors: [] }
  return { valid: false, errors: collectErrors(validateOutlineSchema) }
}

/**
 * Validate a script candidate against the script schema *and* against the
 * outline it is supposed to narrate.
 *
 * The second half is the part JSON Schema cannot express: the script's
 * headings must equal the outline's headings, same count, same order, same
 * strings. Without it a model can emit a perfectly schema-valid script for a
 * different deck, and `render_slides` would happily pair slide 3's bullets
 * with slide 5's narration.
 *
 * A malformed `outline` is reported as such rather than being treated as a
 * script failure, so the model is not sent to fix the wrong artifact.
 *
 * @param outline - the confirmed outline the script must match.
 * @param candidate - the script the model produced.
 * @returns `{ valid, errors }`.
 */
export function validateScript(outline: unknown, candidate: unknown): ValidationResult {
  const outlineResult = validateOutline(outline)
  if (!outlineResult.valid) {
    return {
      valid: false,
      errors: outlineResult.errors.map(
        (error) => `outline is not a valid outline, so the script cannot be checked against it — ${error}`,
      ),
    }
  }

  if (!validateScriptSchema(candidate)) {
    return { valid: false, errors: collectErrors(validateScriptSchema) }
  }

  const expected = (outline as Outline).slides.map((slide) => slide.heading)
  const actual = (candidate as Array<{ heading: string }>).map((entry) => entry.heading)

  if (actual.length !== expected.length) {
    return {
      valid: false,
      errors: [
        `(root): script has ${actual.length} entries but the outline has ${expected.length} slides; ` +
          'there must be exactly one script entry per slide, in slide order',
      ],
    }
  }

  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      return {
        valid: false,
        errors: [
          `/${i}/heading: heading mismatch — expected "${expected[i]}" (outline slide ${i}) ` +
            `but the script has "${actual[i]}"; script entries must match outline headings exactly, in order`,
        ],
      }
    }
  }

  return { valid: true, errors: [] }
}

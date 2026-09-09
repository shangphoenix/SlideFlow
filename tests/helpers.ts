/** Shared fixture loading for the test suite. */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Absolute path to a file under `tests/fixtures`. */
export function fixturePath(...segments: string[]): string {
  return resolve(here, 'fixtures', ...segments)
}

/** Read a fixture as UTF-8 text. */
export function readFixture(...segments: string[]): string {
  return readFileSync(fixturePath(...segments), 'utf8')
}

/** Read and parse a JSON fixture. Returns `unknown` on purpose: validators must not be handed a pre-narrowed value. */
export function readJsonFixture(...segments: string[]): unknown {
  return JSON.parse(readFixture(...segments))
}

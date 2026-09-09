/**
 * Copy skill Markdown into the build output.
 *
 * `tsc` emits only `.ts` -> `.js`. The skill provider resolves its content
 * files relative to `import.meta.url`, so `lib/skills/content/*.md` has to
 * exist next to `lib/skills/provider.js` or `ctx.skills.get()` fails at
 * runtime with ENOENT. Tests import from `src/`, where the files already sit
 * beside the source, which is exactly why this step is easy to forget — hence
 * a build step rather than a manual instruction.
 */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'src/skills/content')
const destination = resolve(root, 'lib/skills/content')

await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true })

console.log(`copied skill content -> ${destination}`)

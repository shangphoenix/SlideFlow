/**
 * The SlideFlow skill provider.
 *
 * Skills in dsh are Markdown instructions, not code. The provider's whole job
 * is to advertise three candidates and, on demand, read the matching file. All
 * deterministic behaviour lives in the tools; the skill bodies only tell the
 * model when to call them and what to do with the answers.
 *
 * Skill names are kebab-case because dsh validates them against
 * `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` and throws on anything else.
 */

import { readFile } from 'node:fs/promises'

import type { SkillCandidate, SkillDefinition, SkillProvider } from '@deepseek-ai/dsh-skill'

/** Provider name; also the `provider` field every candidate must carry. */
export const PROVIDER_NAME = 'slideflow'

/**
 * Precedence rank. Higher than dsh's `BUNDLED_SKILL_RANK` (600) so a
 * same-named first-party skill would win — SlideFlow's names are specific
 * enough that a clash is unlikely, and losing quietly beats shadowing.
 */
const RANK = 700

/**
 * Build one candidate.
 *
 * @param name - kebab-case skill name; also the content filename stem.
 * @param description - routing description shown in the skill catalog.
 * @returns the candidate, with its content file as the opaque locator.
 */
function candidate(name: string, description: string): SkillCandidate {
  return {
    name,
    description,
    provider: PROVIDER_NAME,
    // `custom` is the correct bucket for a third-party plugin's own skills;
    // `bundled` is reserved for skills dsh itself ships.
    source: 'custom',
    invocation: { modelInvocable: true, userInvocable: true },
    rank: RANK,
    locator: new URL(`./content/${name}.md`, import.meta.url),
  }
}

/** The three pipeline stages, in the order the agent runs them. */
export const CANDIDATES: readonly SkillCandidate[] = [
  candidate(
    'outline-skill',
    'Turn a topic (plus optional reference documents) into a validated slide deck outline, ' +
      'then present it to the user for confirmation. Start here for any deck request.',
  ),
  candidate(
    'script-skill',
    'Write a per-slide speaker script for a confirmed outline, validate it against that ' +
      'outline, and present it to the user for confirmation.',
  ),
  candidate(
    'render-skill',
    'Render a confirmed outline and speaker script into Marp markdown and a standalone ' +
      'HTML deck on disk. The final step of the SlideFlow pipeline.',
  ),
]

/**
 * Create the SlideFlow skill provider.
 *
 * @returns a provider ready to hand to `ctx.skills.registerProvider`.
 */
export function createSlideflowSkillProvider(): SkillProvider {
  return {
    name: PROVIDER_NAME,
    list: () => Promise.resolve(CANDIDATES),
    async get(target: SkillCandidate): Promise<SkillDefinition> {
      const content = await readFile(target.locator as URL, 'utf8')
      return { ...target, content } satisfies SkillDefinition
    },
  }
}

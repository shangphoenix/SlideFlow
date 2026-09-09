import type { SkillCandidate } from '@deepseek-ai/dsh-skill'
import { describe, expect, it } from 'vitest'

import { CANDIDATES, PROVIDER_NAME, createSlideflowSkillProvider } from '../src/skills/provider.ts'

const provider = createSlideflowSkillProvider()

/** dsh's own skill-name grammar, from `@deepseek-ai/dsh-skill`. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

async function listCandidates(): Promise<readonly SkillCandidate[]> {
  const listed = await provider.list({})
  // The provider contract permits either a bare array or an observation object.
  return Array.isArray(listed) ? listed : (listed as { candidates: readonly SkillCandidate[] }).candidates
}

async function contentOf(name: string): Promise<string> {
  const candidate = (await listCandidates()).find((c) => c.name === name)
  expect(candidate, `no candidate named ${name}`).toBeDefined()
  const definition = await provider.get(candidate!, {})
  expect(definition, `could not load ${name}`).toBeDefined()
  return definition!.content
}

describe('createSlideflowSkillProvider — catalog', () => {
  it('is named slideflow', () => {
    expect(provider.name).toBe(PROVIDER_NAME)
  })

  it('advertises exactly three candidates', async () => {
    expect(await listCandidates()).toHaveLength(3)
    expect(CANDIDATES).toHaveLength(3)
  })

  it('advertises the three pipeline skills, in pipeline order', async () => {
    const names = (await listCandidates()).map((c) => c.name)
    expect(names).toEqual(['outline-skill', 'script-skill', 'render-skill'])
  })

  it('uses names dsh will accept', async () => {
    // dsh throws on a non-kebab-case skill name at registration time, so this
    // is a real load-bearing constraint, not a style preference.
    for (const candidate of await listCandidates()) {
      expect(candidate.name, candidate.name).toMatch(SKILL_NAME)
    }
  })

  it('marks every skill both model- and user-invocable', async () => {
    for (const candidate of await listCandidates()) {
      expect(candidate.invocation.modelInvocable, candidate.name).toBe(true)
      expect(candidate.invocation.userInvocable, candidate.name).toBe(true)
    }
  })

  it('declares source "custom", not the reserved "bundled"', async () => {
    for (const candidate of await listCandidates()) {
      expect(candidate.source, candidate.name).toBe('custom')
    }
  })

  it('claims each candidate for this provider, as dsh validates', async () => {
    for (const candidate of await listCandidates()) {
      expect(candidate.provider, candidate.name).toBe(PROVIDER_NAME)
      expect(Number.isFinite(candidate.rank), candidate.name).toBe(true)
    }
  })

  it('gives every candidate a non-empty description', async () => {
    for (const candidate of await listCandidates()) {
      expect(candidate.description.length, candidate.name).toBeGreaterThan(0)
    }
  })
})

describe('createSlideflowSkillProvider — loading', () => {
  it('loads content for every advertised candidate', async () => {
    for (const candidate of await listCandidates()) {
      const definition = await provider.get(candidate, {})
      expect(definition, candidate.name).toBeDefined()
      expect(definition!.name).toBe(candidate.name)
      expect(definition!.content.length, candidate.name).toBeGreaterThan(0)
    }
  })

  it('preserves candidate metadata on the loaded definition', async () => {
    const [first] = await listCandidates()
    const definition = await provider.get(first!, {})
    expect(definition).toMatchObject({
      name: first!.name,
      description: first!.description,
      provider: PROVIDER_NAME,
      source: 'custom',
      invocation: { modelInvocable: true, userInvocable: true },
    })
  })
})

/**
 * These are the tests that catch drift: a skill body naming a tool that no
 * longer exists, or a tool renamed without updating the instructions that tell
 * the model to call it. Both failures are invisible until a live run.
 */
describe('skill content references the real tool names', () => {
  const REQUIRED_MENTIONS: Array<[skill: string, tools: string[]]> = [
    ['outline-skill', ['search_reference', 'validate_outline']],
    ['script-skill', ['validate_script']],
    ['render-skill', ['render_slides']],
  ]

  it.each(REQUIRED_MENTIONS)('%s names %j', async (skill, tools) => {
    const content = await contentOf(skill)
    for (const tool of tools) {
      expect(content, `${skill} should mention ${tool}`).toContain(tool)
    }
  })

  it('outline-skill does not send the model to render or script tools', async () => {
    const content = await contentOf('outline-skill')
    expect(content).not.toContain('validate_script')
  })

  it('render-skill names the tool it must call', async () => {
    expect(await contentOf('render-skill')).toContain('render_slides')
  })
})

describe('skill content encodes the pipeline contract', () => {
  it('outline-skill and script-skill hold a confirmation gate; render-skill does not', async () => {
    expect(await contentOf('outline-skill')).toContain('## Confirmation gate')
    expect(await contentOf('script-skill')).toContain('## Confirmation gate')
    expect(await contentOf('render-skill')).not.toContain('## Confirmation gate')
  })

  it('every skill states a retry policy', async () => {
    for (const name of ['outline-skill', 'script-skill', 'render-skill']) {
      const content = await contentOf(name)
      expect(content, name).toContain('## Retry policy')
      expect(content, name).toContain('three')
      expect(content, name).toContain('verbatim')
    }
  })

  it('script-skill spells out the re-invocation decision rule by name', async () => {
    const content = await contentOf('script-skill')
    // Structural feedback must route back to the outline stage; wording-only
    // feedback must stay put. Both branches have to be named explicitly.
    expect(content).toContain('re-invoke `outline-skill`')
    expect(content).toContain('re-invoke `script-skill`')
  })

  it('each skill names the next stage it hands off to', async () => {
    expect(await contentOf('outline-skill')).toContain('script-skill')
    expect(await contentOf('script-skill')).toContain('render-skill')
    expect(await contentOf('render-skill')).toContain('terminal stage')
  })

  it('every skill body carries the sections a reader relies on', async () => {
    for (const name of ['outline-skill', 'script-skill', 'render-skill']) {
      const content = await contentOf(name)
      for (const section of ['## Role', '## Inputs', '## Procedure', '## Output contract', '## Handoff rule']) {
        expect(content, `${name} is missing ${section}`).toContain(section)
      }
    }
  })
})

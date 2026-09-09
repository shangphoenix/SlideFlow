import { describe, expect, it } from 'vitest'

import { outlineAndScriptToMarp } from '../src/render/to-marp-markdown.ts'
import type { Outline, ScriptEntry } from '../src/types.ts'
import { readJsonFixture } from './helpers.ts'

const outline = readJsonFixture('render', 'sample-outline.json') as Outline
const script = readJsonFixture('render', 'sample-script.json') as ScriptEntry[]

/** Speaker-note comments, in document order. */
function speakerNotes(markdown: string): string[] {
  return [...markdown.matchAll(/<!--([\s\S]*?)-->/g)].map((match) => match[1]!.trim())
}

/** Bullet lines belonging to each `## ` slide, in slide order. */
function bulletsPerSlide(markdown: string): string[][] {
  // Everything after the title slide, split on the slide separator.
  const sections = markdown.split(/\n---\n/).filter((section) => section.includes('## '))
  return sections.map((section) =>
    section
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2)),
  )
}

describe('outlineAndScriptToMarp — document structure', () => {
  const markdown = outlineAndScriptToMarp(outline, script)

  it('opens with Marp frontmatter', () => {
    expect(markdown.startsWith('---\nmarp: true\ntheme: default\npaginate: true\n---\n')).toBe(true)
  })

  it('renders the deck title as the single h1', () => {
    const h1s = markdown.split('\n').filter((line) => line.startsWith('# '))
    expect(h1s).toEqual([`# ${outline.title}`])
  })

  it('emits exactly one `## ` heading per slide, in outline order', () => {
    const headings = markdown
      .split('\n')
      .filter((line) => line.startsWith('## '))
      .map((line) => line.slice(3))

    expect(headings).toHaveLength(outline.slides.length)
    expect(headings).toEqual(outline.slides.map((slide) => slide.heading))
  })

  it('emits exactly as many bullets per slide as that slide has key_points', () => {
    const bullets = bulletsPerSlide(markdown)

    expect(bullets).toHaveLength(outline.slides.length)
    // The fixture is deliberately non-uniform: 2, 3, 1, 4.
    expect(bullets.map((list) => list.length)).toEqual([2, 3, 1, 4])
    expect(bullets.map((list) => list.length)).toEqual(
      outline.slides.map((slide) => slide.key_points.length),
    )
  })

  it('renders each key point verbatim as its own bullet', () => {
    const bullets = bulletsPerSlide(markdown)
    outline.slides.forEach((slide, index) => {
      expect(bullets[index]).toEqual(slide.key_points)
    })
  })

  it('separates slides with `---` and does not emit a trailing separator', () => {
    // 1 frontmatter close + 1 title-slide separator + (slides - 1) between slides.
    const separators = markdown.split('\n').filter((line) => line === '---')
    expect(separators).toHaveLength(2 + outline.slides.length)
    expect(markdown.trimEnd().endsWith('---')).toBe(false)
  })

  it('ends with exactly one trailing newline', () => {
    expect(markdown.endsWith('\n')).toBe(true)
    expect(markdown.endsWith('\n\n')).toBe(false)
  })
})

describe('outlineAndScriptToMarp — speaker notes', () => {
  const markdown = outlineAndScriptToMarp(outline, script)

  it('emits exactly one speaker-note comment per slide', () => {
    expect(speakerNotes(markdown)).toHaveLength(outline.slides.length)
  })

  it('puts each slide’s own script_text in its own comment, in order', () => {
    expect(speakerNotes(markdown)).toEqual(script.map((entry) => entry.script_text))
  })

  it('places each comment after that slide’s bullets and before the next slide', () => {
    const sections = markdown.split(/\n---\n/).filter((section) => section.includes('## '))
    sections.forEach((section, index) => {
      const lastBullet = section.lastIndexOf('\n- ')
      const comment = section.indexOf('<!--')
      expect(comment, `slide ${index}`).toBeGreaterThan(lastBullet)
      expect(section).toContain(script[index]!.script_text)
    })
  })

  it('neutralises a comment terminator inside script text so notes cannot leak onto the slide', () => {
    const hostile: ScriptEntry[] = script.map((entry, index) =>
      index === 0 ? { ...entry, script_text: 'before --> after' } : entry,
    )
    const rendered = outlineAndScriptToMarp(outline, hostile)

    // Still exactly one comment per slide: the injected terminator did not close one early.
    expect(speakerNotes(rendered)).toHaveLength(outline.slides.length)
    expect(rendered).toContain('before --&gt; after')
    expect(rendered).not.toContain('before --> after')
  })
})

describe('outlineAndScriptToMarp — outline-only rendering', () => {
  const markdown = outlineAndScriptToMarp(outline)

  it('emits no speaker-note comments when no script is supplied', () => {
    expect(speakerNotes(markdown)).toEqual([])
    expect(markdown).not.toContain('<!--')
  })

  it('still emits every heading and every bullet', () => {
    const headings = markdown.split('\n').filter((line) => line.startsWith('## '))
    expect(headings).toHaveLength(outline.slides.length)
    expect(bulletsPerSlide(markdown).map((list) => list.length)).toEqual([2, 3, 1, 4])
  })

  it('renders identically to passing an explicit undefined', () => {
    expect(outlineAndScriptToMarp(outline, undefined)).toBe(markdown)
  })
})

describe('outlineAndScriptToMarp — purity', () => {
  it('is deterministic', () => {
    expect(outlineAndScriptToMarp(outline, script)).toBe(outlineAndScriptToMarp(outline, script))
  })

  it('does not mutate its inputs', () => {
    const outlineCopy = structuredClone(outline)
    const scriptCopy = structuredClone(script)
    outlineAndScriptToMarp(outlineCopy, scriptCopy)
    expect(outlineCopy).toEqual(outline)
    expect(scriptCopy).toEqual(script)
  })

  it('handles CJK content without mangling it', () => {
    const cjk = readJsonFixture('outlines', 'valid-cjk.json') as Outline
    const rendered = outlineAndScriptToMarp(cjk)
    expect(rendered).toContain(`# ${cjk.title}`)
    for (const slide of cjk.slides) {
      expect(rendered).toContain(`## ${slide.heading}`)
      for (const point of slide.key_points) expect(rendered).toContain(`- ${point}`)
    }
  })
})

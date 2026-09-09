import { describe, expect, it } from 'vitest'

import { renderHtml } from '../src/render/render-html.ts'
import { outlineAndScriptToMarp } from '../src/render/to-marp-markdown.ts'
import type { Outline, ScriptEntry } from '../src/types.ts'
import { readJsonFixture } from './helpers.ts'

const outline = readJsonFixture('render', 'sample-outline.json') as Outline
const script = readJsonFixture('render', 'sample-script.json') as ScriptEntry[]
const markdown = outlineAndScriptToMarp(outline, script)

describe('renderHtml — document shape', () => {
  const { html, css } = renderHtml(markdown, outline.title)

  it('produces a standalone document with the expected skeleton', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<body>')
    expect(html.trimEnd().endsWith('</html>')).toBe(true)
  })

  it('inlines the theme CSS Marp returned, so the file needs no external assets', () => {
    expect(css.length).toBeGreaterThan(0)
    expect(html).toContain(`<style>${css}</style>`)
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet/i)
  })

  it('uses the supplied title', () => {
    expect(html).toContain(`<title>${outline.title}</title>`)
  })

  it('falls back to a default title', () => {
    expect(renderHtml(markdown).html).toContain('<title>SlideFlow deck</title>')
  })

  it('escapes a title containing markup rather than injecting it', () => {
    const { html: escaped } = renderHtml(markdown, 'A <script>alert(1)</script> title')
    expect(escaped).toContain('<title>A &lt;script&gt;alert(1)&lt;/script&gt; title</title>')
    expect(escaped).not.toContain('<title>A <script>')
  })
})

describe('renderHtml — deck content', () => {
  const { html } = renderHtml(markdown, outline.title)

  it('renders one Marp section per slide, plus the title slide', () => {
    const sections = html.match(/<section[^>]*>/g) ?? []
    expect(sections).toHaveLength(outline.slides.length + 1)
  })

  it('carries every slide heading into the rendered HTML', () => {
    for (const slide of outline.slides) {
      expect(html).toContain(slide.heading)
    }
  })

  it('carries every key point into the rendered HTML', () => {
    for (const slide of outline.slides) {
      for (const point of slide.key_points) {
        // Marp escapes ampersands and angle brackets; the fixture has none,
        // so a verbatim check is sound here.
        expect(html).toContain(point)
      }
    }
  })

  it('keeps speaker notes out of the visible deck', () => {
    // Marp turns markdown comments into presenter notes, not slide content.
    for (const entry of script) {
      const firstSentence = entry.script_text.split('.')[0]!
      expect(html).not.toContain(firstSentence)
    }
  })
})

describe('renderHtml — behaviour', () => {
  it('is deterministic for identical input', () => {
    expect(renderHtml(markdown, outline.title).html).toBe(renderHtml(markdown, outline.title).html)
  })

  it('renders an outline-only deck', () => {
    const { html } = renderHtml(outlineAndScriptToMarp(outline), outline.title)
    const sections = html.match(/<section[^>]*>/g) ?? []
    expect(sections).toHaveLength(outline.slides.length + 1)
  })

  it('renders CJK content', () => {
    const cjk = readJsonFixture('outlines', 'valid-cjk.json') as Outline
    const { html } = renderHtml(outlineAndScriptToMarp(cjk), cjk.title)
    for (const slide of cjk.slides) {
      expect(html).toContain(slide.heading)
    }
  })

  it('does not pass raw HTML in the markdown body through to the deck', () => {
    // `html: false` is set deliberately: deck bodies are model-produced text.
    const withMarkup = outlineAndScriptToMarp({
      ...outline,
      slides: [
        { ...outline.slides[0]!, key_points: ['<img src=x onerror="alert(1)">'] },
        ...outline.slides.slice(1),
      ],
    })
    const { html } = renderHtml(withMarkup)
    expect(html).not.toContain('<img src=x onerror=')
    expect(html).toContain('&lt;img')
  })
})

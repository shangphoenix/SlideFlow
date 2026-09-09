/**
 * Outline + script -> Marp markdown.
 *
 * Pure and total: same input, same string, no I/O. Everything about the deck's
 * final shape is decided here, which is what makes the rendering path testable
 * without a browser or a screenshot.
 */

import type { Outline, ScriptEntry } from '../types.ts'

/** Marp frontmatter. One default theme, deliberately — see DECISIONS.md. */
const FRONTMATTER = ['---', 'marp: true', 'theme: default', 'paginate: true', '---'].join('\n')

/**
 * Neutralise a comment terminator inside speaker-note text.
 *
 * A `-->` in the narration would otherwise close the HTML comment early and
 * spill the rest of the script onto the visible slide.
 *
 * @param text - raw script text.
 * @returns text safe to embed in an HTML comment.
 */
function escapeCommentText(text: string): string {
  return text.replaceAll('-->', '--&gt;')
}

/**
 * Render an outline, optionally with its speaker script, as Marp markdown.
 *
 * Script entries are paired with slides **by index**, which is sound because
 * `validateScript` has already established that the two lists have equal
 * length and identical headings in identical order. When `script` is omitted
 * the deck renders outline-only, with no speaker-note comments at all.
 *
 * @param outline - the deck outline.
 * @param script - matching speaker script, or `undefined` for an outline-only deck.
 * @returns Marp markdown: a title slide, then one slide per outline entry, with
 *   no trailing separator.
 */
export function outlineAndScriptToMarp(outline: Outline, script?: ScriptEntry[]): string {
  const sections: string[] = [`${FRONTMATTER}\n\n# ${outline.title}`]

  outline.slides.forEach((slide, index) => {
    const lines = [`## ${slide.heading}`, '', ...slide.key_points.map((point) => `- ${point}`)]

    const entry = script?.[index]
    if (entry !== undefined) {
      lines.push('', `<!-- ${escapeCommentText(entry.script_text)} -->`)
    }

    sections.push(lines.join('\n'))
  })

  // Slides are separated by `---`; there is no separator after the last one.
  return `${sections.join('\n\n---\n\n')}\n`
}

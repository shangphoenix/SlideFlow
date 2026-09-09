/**
 * Marp markdown -> a standalone HTML deck.
 *
 * `@marp-team/marp-core` hands back `html` and `css` separately; this module
 * owns the (small, boring, and therefore testable) decision of how to staple
 * them into one self-contained file the user can open directly.
 */

import { Marp } from '@marp-team/marp-core'

/** The two halves of a rendered deck. */
export interface RenderedDeck {
  /** The complete standalone HTML document. */
  html: string
  /** The theme CSS, returned separately for callers that want to re-style. */
  css: string
}

/**
 * Escape text for interpolation into HTML character data.
 *
 * @param text - raw text.
 * @returns text safe inside an element body.
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * Render Marp markdown into a standalone HTML document.
 *
 * `html: false` keeps raw HTML in the markdown inert — the deck body is
 * model-produced text, and nothing in this pipeline needs to inject markup.
 * `math: false` skips loading KaTeX/MathJax, which SlideFlow does not use.
 *
 * @param markdown - Marp markdown, typically from `outlineAndScriptToMarp`.
 * @param title - optional `<title>` for the document.
 * @returns the standalone document plus the theme CSS on its own.
 */
export function renderHtml(markdown: string, title = 'SlideFlow deck'): RenderedDeck {
  const marp = new Marp({ html: false, math: false })
  const { html, css } = marp.render(markdown)

  const document = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${css}</style>`,
    '</head>',
    `<body>${html}</body>`,
    '</html>',
  ].join('\n')

  return { html: document, css }
}

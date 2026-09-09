# SlideFlow

SlideFlow is a plugin for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness), an "everything-is-a-plugin" Node/TypeScript agent harness built on the Cordis framework. It turns a topic — plus, optionally, a folder of your own reference documents — into a slide deck, in three agent-orchestrated stages with a human confirmation gate between each one: draft an outline, write the per-slide speaker script, render Marp markdown and a standalone HTML deck. The retrieval, validation, and rendering are deterministic code shipped as native tools; the three skills are Markdown instructions telling the agent when to call them and where to stop and ask.

## Architecture

```
user: topic / key points  (+ optional reference doc paths)
        │
        ▼
  ┌───────────────┐        search_reference ──► ctx.tools.execute()
  │ outline-skill │────────►  (BM25 over chunked text)   │
  └───────────────┘        validate_outline              ▼
        │                                    mcp__filesystem__read_text_file
        ▼                                                │
  [ outline confirmation gate ] ──revise──┐               ▼
        │ approved                        │      external MCP filesystem
        ▼                                 │      server (sandboxed to one
  ┌───────────────┐                       │      allowed directory)
  │ script-skill  │────────► validate_script
  └───────────────┘                       │
        │                                 │
        ▼                                 │
  [ script confirmation gate ] ───────────┤
        │ approved       structural feedback re-enters at outline-skill;
        ▼                wording-only feedback re-enters at script-skill
  ┌───────────────┐
  │ render-skill  │────────► render_slides ──► node:fs ──► slides.md
  └───────────────┘                                        slides.html
```

Two things in that diagram carry most of the design weight:

- **The gates are real stops.** Each skill presents its artifact in prose, asks a yes/revise question, and waits for a natural-language reply. Nothing is written to disk until both artifacts are approved.
- **Revision is routed, not guessed.** When the user asks for changes at the script gate, `script-skill` classifies the feedback: structural (headings, slide count, order, coverage) goes back to `outline-skill`; wording-only goes back to `script-skill` with the outline untouched. That rule is written out explicitly in the skill body, with worked examples on both sides.

## Skills and tools

### Skills

Skill names are kebab-case because dsh validates them against `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` and throws on anything else.

| Skill | Stage | Gate | Hands off to |
|---|---|---|---|
| `outline-skill` | Draft and validate a deck outline, grounded in reference docs when supplied | Yes — outline confirmation | `script-skill` |
| `script-skill` | Write and validate the per-slide speaker script | Yes — script confirmation | `render-skill`, or back to `outline-skill` for structural revisions |
| `render-skill` | Render the confirmed artifacts to disk | No — terminal stage | — |

### Tools

| Tool | Arguments | Returns |
|---|---|---|
| `search_reference` | `query`, `paths[]`, `top_k?` | Top-k passages by BM25 across the named documents |
| `validate_outline` | `candidate` | `{ valid, errors[] }` against the outline JSON Schema |
| `validate_script` | `outline`, `candidate` | `{ valid, errors[] }` — schema, plus headings matching the outline exactly, in order |
| `render_slides` | `outline`, `script`, `output_dir?` | `{ markdown_path, html_path, slide_count }`; re-validates before writing |

`search_reference` does not touch the filesystem itself. It re-enters the harness tool pipeline via `ctx.tools.execute()` to call `mcp__<serverName>__read_text_file`, a tool bridged in from an external MCP filesystem server. dsh is an MCP **client**: it consumes external MCP servers and cannot expose itself as one. SlideFlow's tools are therefore native dsh tools, not MCP tools.

## Quick start

```sh
git clone <this repo> && cd SlideFlow
npm install
npm run build
npm link
```

Then, from your dsh installation:

```sh
npm link slideflow
```

Wire it up with an overlay patch (see [`cordis.patch.example.yml`](./cordis.patch.example.yml)):

```yaml
- insert:
    - id: mcp-filesystem
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: filesystem
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/absolute/path/to/reference/docs']
        env: {}
        cwd: !!js process.cwd()
    - id: slideflow
      name: slideflow
      config:
        mcpServerName: filesystem
```

```sh
npx @deepseek-ai/dsh web --patch cordis.patch.example.yml
```

The final `args` entry to the MCP filesystem server is the sandbox boundary — that server refuses to read anything outside it. `mcpServerName` in SlideFlow's config must equal `serverName` on the mcp-client instance; that is how `search_reference` derives the bridged tool name.

> **Live dsh integration is untested in this pass.** dsh was not installed locally during development, so the plugin has never been loaded by a running harness. Every API this plugin calls was verified against the installed packages' shipped type definitions and compiled sources, and the whole codebase typechecks against them — but the config wiring above and the MCP filesystem tool's exact response shape are the two things to confirm on first live run. See "Open items" in [DECISIONS.md](./DECISIONS.md).

## Configuration

Four knobs, all optional:

| Key | Default | Meaning |
|---|---|---|
| `mcpServerName` | `filesystem` | `serverName` of the mcp-client instance backing `search_reference`. Determines the bridged tool name `mcp__<name>__read_text_file`. |
| `defaultTopK` | `5` | Passages `search_reference` returns when the model omits `top_k`. |
| `bm25.k1` | `1.5` | Term-frequency saturation. Higher rewards repeated terms more. |
| `bm25.b` | `0.75` | Document-length normalisation, 0 (off) to 1 (full). |
| `outputDir` | `process.cwd()` | Where `render_slides` writes when the model omits `output_dir`. |

## Development

```sh
npm run typecheck    # tsc over src/ and tests/
npm test             # vitest run
npm run test:watch   # vitest in watch mode
npm run build        # tsc -> lib/, then copy skill markdown into lib/
npm run clean        # remove lib/
```

`npm run build` has a second step for a reason: `tsc` emits only JavaScript, and the skill provider resolves its Markdown bodies relative to `import.meta.url`. Without the copy step, `lib/skills/provider.js` would look for content files that are not there. Tests import from `src/`, where the Markdown already sits beside the source — which is exactly why the omission would not show up in the test suite.

Node 22.19+ or 24+, matching dsh's own `engines`.

## Testing strategy

134 tests across 8 files, covering the deterministic half of the system:

| File | Covers |
|---|---|
| `tokenize.spec.ts` | Latin tokenisation, Han bigrams, script-boundary splitting, token spans |
| `chunk.spec.ts` | Paragraph splitting, window overlap size, determinism, sizing guards |
| `bm25.spec.ts` | Hand-computed scores, `k1`/`b` sensitivity, edge cases, end-to-end ranking over fixture documents |
| `validate-outline.spec.ts` | Every valid and invalid outline fixture, plus each schema boundary |
| `validate-script.spec.ts` | Schema violations and the cross-document heading check |
| `render-markdown.spec.ts` | Heading count, per-slide bullet counts, speaker-note pairing, comment-terminator escaping |
| `render-html.spec.ts` | Standalone document shape, inlined CSS, content carry-through, markup escaping |
| `skill-provider.spec.ts` | Catalog shape, dsh's name grammar, and skill bodies naming the real tool names |

The BM25 tests assert scores computed by hand from the Okapi formula and compared to twelve decimal places, not merely "something non-zero came back". The validator tests assert that each error string names the field and rule actually violated, not merely that `valid === false`. The skill-provider tests assert that each skill body contains the literal tool-name strings it is supposed to call, so renaming a tool without updating its instructions fails CI.

**What is not tested, and why.** Nothing in this codebase deterministically generates outline or script *content*. That is produced by the LLM at runtime, following the Markdown instructions in `src/skills/content/`. The automated tests therefore cover schema validation, BM25 retrieval, and Marp rendering structure — the parts that are deterministic functions of their inputs — and say nothing about whether the model writes a *good* outline. Testing that would require live API calls and eval-style scoring against reference decks, which is out of scope here. The suite verifies that a malformed outline is always caught, never that a well-formed one is any good.

Live MCP integration is likewise untested: `search_reference`'s call into `ctx.tools.execute()` has no coverage, because exercising it meaningfully requires a running harness with a configured MCP server rather than a mock that would only assert this code calls the API the way this code calls it.

## Known limitations

- **CJK tokenisation is bigram-based, not segmented.** A run of Han characters becomes overlapping character bigrams. This needs no dictionary and no dependency, and it retrieves acceptably, but it is measurably worse than real word segmentation: it over-matches on shared character pairs across unrelated words, and BM25's IDF is computed over bigrams whose document frequencies do not correspond to word frequencies.
- **MCP wiring is documented but not live-tested.** See the note under Quick start.
- **BM25 has no synonym matching, by construction.** Query "car", document says "automobile", score zero. This is the acknowledged cost of not using embeddings.
- **No index is persisted.** Every `search_reference` call re-reads and re-chunks the named documents. Correct and simple at the intended scale of tens of documents; wasteful well before hundreds.
- **One theme.** Marp's `default`, deliberately. No theme system.
- **`render_slides` overwrites.** Re-rendering into the same directory replaces `slides.md` and `slides.html` without prompting.
- **A transitive dependency of `@marp-team/marp-core` has open advisories.** `speech-rule-engine` (Marp's MathML/accessibility subsystem) depends on a vulnerable `@xmldom/xmldom` range; `npm audit fix` cannot resolve it without a breaking `marp-core` major bump. SlideFlow calls `new Marp({ math: false })`, so that subsystem is never invoked at runtime — the vulnerable code path is unreachable here, but `npm audit` will still flag it until upstream ships a fix.

## License

MIT.

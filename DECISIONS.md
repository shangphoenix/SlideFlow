# Design decisions

Engineering notes on why SlideFlow is built the way it is. Written to be read cold — by a reviewer, or by me before an interview.

The Chinese-language design document at `docs/superpowers/specs/2026-09-09-slideflow-design.md` records the original scoping. This file records what the implementation actually decided, including the places where contact with the real dsh API changed the plan.

---

## 1. Three separate skills, agent-orchestrated, rather than one skill with internal state

A single `make_slides` skill holding an internal state machine — drafting, awaiting outline approval, drafting script, awaiting script approval, rendering — would work. It is the wrong shape here for three reasons.

**Each stage is independently useful.** Someone who already has an outline can invoke `script-skill` directly. Someone who has both artifacts in a file can invoke `render-skill`. A monolithic skill would have to grow entry-point parameters to express "start from the middle", which is a state machine with a public API — the worst of both.

**The conversation is already the state.** dsh's agent loop holds the transcript. A skill that also tracks "which phase am I in" duplicates that, and the duplicate can disagree with the transcript after a user says something unexpected. Three stateless skills, each of which reads the current situation and acts, cannot drift out of sync with a conversation they do not model.

**Testability and blast radius.** Each skill body is independently readable and independently checkable — `skill-provider.spec.ts` asserts each one names the tools it is supposed to call. A change to how scripts get revised touches one file and cannot alter outline behaviour.

The cost is real and worth naming: correctness now depends on the model following prose. There is no compiler for "wait for confirmation before advancing". That is mitigated by the validators and by `render_slides` re-validating in-process, but it is not eliminated. See §3.

## 2. BM25 over embeddings

**Dependency weight.** BM25 is roughly eighty lines of arithmetic over token counts. Embeddings mean an embedding model (a network call per document, or a local model to ship), a vector store, an index build step, and a staleness question. For a corpus of tens of documents that is a large amount of infrastructure to buy a marginal recall improvement.

**Scale genuinely does not justify it.** The intended input is the handful of documents a user names for one deck. At that size the whole corpus can be re-read and re-scored per query in milliseconds, which is why there is no persisted index at all — see §7.

**Determinism.** BM25 gives the same ranking for the same input, forever. Every retrieval test in `bm25.spec.ts` asserts exact hand-computed scores. An embedding pipeline's outputs shift when the model version does, which turns retrieval tests into snapshot tests.

**Deliberate non-repetition.** My other retrieval work (VeriClimate) already implements BM25 + dense + reranking. Rebuilding that here would demonstrate nothing new. Implementing Okapi BM25 from the formula, with parameter sensitivity tests that prove `k1` and `b` are actually wired through and actually change ranking order, demonstrates that I understand what those components do rather than that I can assemble a pipeline.

**The honest cost:** no synonym matching. Query "car", document says "automobile", score zero. Stated plainly in the README rather than buried.

## 3. Validator tools plus a prose retry policy — because that is the only structural enforcement dsh currently offers

This is the sharpest constraint in the project and the one most worth being precise about.

**What I wanted.** A framework hook that intercepts free-form model output — the outline JSON the model writes into the conversation — validates it against a schema, and forces a retry before the user ever sees it. That is what a "structured output" guarantee would mean here.

**What dsh actually provides.** Argument schemas on tool *calls* are enforced: `defineTool`'s parameter DSL compiles to JSON Schema and `validateArgs` runs before the handler. The `tools/pre-execute` and `tools/post-execute` pipelines can deny or rewrite tool results. All of that governs the tool boundary. None of it governs prose the model emits directly into the conversation — and the outline is prose the model emits into the conversation, because the model is what produces it.

**So the enforcement is layered, deliberately, and each layer is honest about what it can promise:**

1. `validate_outline` / `validate_script` are tools the skill instructs the model to call on every draft. They return `{ valid, errors[] }` with errors naming the exact failing path and rule, because a retry needs something actionable.
2. The retry policy is prose: at most three validate-and-revise cycles, and on the third failure **stop and show the user the raw validator errors verbatim**. The bound matters — an unbounded loop burns tokens converging on nothing. Showing the raw errors matters more: the failure mode I most wanted to avoid is a model that quietly gives up and presents an invalid artifact as though it were fine.
3. `render_slides` re-validates both artifacts in-process before writing a byte. This is the only layer that is actual enforcement rather than instruction, and it is the last gate before output reaches disk. It is cheap, so it runs unconditionally even though the skills already validated.

A model that ignores its instructions can still show a user a malformed outline. It cannot get a malformed deck written to disk. That is the guarantee the architecture can actually make, and claiming more would be false.

**Why the validator tools take `type: 'json'` parameters.** `defineTool`'s DSL could mirror the outline schema as a typed object parameter. It deliberately does not. Two reasons: a framework-level argument rejection returns a generic violation list instead of the detailed, field-by-field feedback the retry loop needs; and maintaining the same constraints in two schema dialects guarantees they eventually disagree. `type: 'json'` is the DSL's documented escape hatch for "arbitrary shape, the tool validates it itself", and ajv against the real schema is the single source of truth.

## 4. MCP integration: consume-only, and what the sandbox is actually for

**Direction.** dsh is an MCP **client**. It bridges external MCP servers' tools into its own native tool registry. It cannot expose itself as an MCP server. SlideFlow's four tools are native dsh tools; nothing here is reachable over MCP. Getting this backwards is an easy and very visible error, so: SlideFlow consumes MCP, it does not serve it.

**Mechanism.** An `@deepseek-ai/dsh-mcp-client` instance configured with `serverName: filesystem` launches `@modelcontextprotocol/server-filesystem` over stdio and bridges its tools under the name pattern `mcp__<serverName>__<remoteTool>`. The one SlideFlow uses is **`mcp__filesystem__read_text_file`**. (That server also exposes `read_file`; `read_text_file` is the correct choice for plain text.)

`search_reference`'s handler calls it by re-entering the harness's own pipeline:

```ts
const result = await ctx.tools.execute({
  callId: ToolCallId(randomUUID()),
  rootCallId: exec.rootCallId,
  parent: exec.token,
  name: `mcp__${config.mcpServerName}__read_text_file`,
  arguments: { path },
  signal: exec.signal,
  agent: exec.agent,
})
```

Propagating `rootCallId`, `parent`, and `agent` is not decoration. `ToolExecutionInput`'s own documentation states that under program-tool-calling mode a call *without* a parent is denied as `UNKNOWN_TOOL` before the policy pipeline runs. Passing the enclosing execution's token is what marks this as a legitimate nested dispatch rather than a model-direct call.

**What the sandbox boundary is for.** The MCP filesystem server is launched with an explicit allowed-directory argument and refuses reads outside it. That containment applies to **reference documents supplied by the user** — the untrusted input in this system. The value is that the check lives in a separate process with a single job, rather than in a path-validation function I would have to write correctly and keep correct.

**What it is not for.** It is not a general filesystem abstraction for the plugin. See §5.

## 5. `render_slides` writes with `node:fs`, not the MCP `write_file` tool

A deliberate asymmetry: reads go through MCP, writes do not.

**The boundary exists to contain untrusted reads.** Reference documents are user-supplied paths pointing at material this plugin did not create. The deck is the plugin's own output, produced by code in this repository from artifacts the user just approved on screen. Those are different trust situations and there is no reason to route them through the same mechanism.

**Routing writes through MCP would actively make the sandbox worse.** The MCP filesystem server has one allowed directory. Writing the deck through it would force that directory to be *both* the reference-document root *and* the output root — either the user must write their deck into the folder of source material, or they must widen the allowed directory to cover both. The read sandbox gets looser precisely because of a write that never needed it.

**It also removes a hard dependency.** `render_slides` works with no MCP server configured at all. Only `search_reference` requires one, and only when the user actually supplies reference documents. Someone who just wants a deck from a topic never needs to configure MCP.

The tradeoff: `render_slides` can write anywhere the harness process can write. That is the same authority any native dsh tool has, and it is bounded by user confirmation — the render stage runs only after the user has approved both artifacts.

## 6. Confirm-and-re-execute, and the exact routing rule

The gates are plain conversation: present the artifact in prose, ask, wait. No UI mechanism, because none is needed — the harness already has a channel for the user to reply in.

The part that needed actual design is what happens on "not quite". Feedback at the script gate can mean two very different things, and guessing wrong wastes a full round trip in the wrong stage. So `script-skill` states the rule outright:

> **Does the feedback change the deck's structure — headings, slide count, order, or which topics are covered?**
>
> - **Yes → re-invoke `outline-skill`**, passing the current outline and the feedback. The outline is revised, re-validated, and re-confirmed at the outline gate before a new script is written.
> - **No → re-invoke `script-skill` alone**, keeping the confirmed outline byte-for-byte. Only `script_text` values change.

Mixed feedback ("shorten slide 2 and add a slide about rollout") is treated as structural, because reapplying wording after structure is cheap and reapplying structure after wording is not. Genuinely ambiguous feedback gets one clarifying question rather than a guess.

The skill body carries worked examples on both sides — "rename slide 3" is structural because the heading is the join key; "too formal" is not. That specificity is the point: a vague instruction to "re-run the appropriate skill" would be followed inconsistently.

**Why the rule is enforceable at all.** Because `validate_script` cross-checks headings against the outline. If the model tries to patch a script to fit a structure the confirmed outline no longer describes, validation rejects it, and the error message says exactly which index diverged. The routing rule and the validator are the same design decision seen from two sides.

## 7. Chunking and tokenisation tradeoffs

**Paragraphs as the unit.** Blank-line boundaries are author-chosen semantic boundaries and cost nothing to detect. A paragraph within budget becomes one chunk verbatim. Only oversized paragraphs are windowed, at 150 tokens with 30 overlapping — the overlap so a phrase straddling a boundary survives intact in one window.

Windowing needed chunk *text*, not just token counts, so `tokenizeWithSpans` returns each token's source span and windows slice the original string by span. This is why `tokenize` is implemented as a projection of the span version rather than the other way round.

**CJK bigrams.** Han runs have no spaces, so whitespace splitting yields one enormous token. The options were a segmentation dictionary (jieba-class: real accuracy, a heavyweight dependency, and a dictionary to keep current) or character bigrams. Bigrams won on dependency weight, and the limitation is stated in the README rather than hidden:

- **Over-matching.** 「检索算法」and 「搜索算法」share the bigram 「算法」, which is right. But unrelated words sharing a character pair also match, and bigrams cross word boundaries — 「索算」 in 「检索算法」 is not a word at all.
- **Distorted IDF.** Document frequencies are computed over bigrams, and a bigram's frequency is not its word's frequency. The ranking is still useful; it is not the ranking real segmentation would produce.
- **What it buys.** Zero dependencies, no dictionary, deterministic, and it handles mixed Chinese-English text — which real technical documents are full of — without a language-detection step. `tokenize.spec.ts` pins the Latin/Han boundary behaviour explicitly.

**No persisted index.** IDF is computed fresh per call over exactly the chunks passed in. At the intended scale — the documents named for one deck — this is fast and has no invalidation problem. It would be the first thing to change if the corpus grew to hundreds of documents.

## 8. What is tested, what is not, and why

**Tested (134 tests, 8 files).** Everything that is a deterministic function of its inputs: tokenisation including the Latin/Han boundary, chunking including exact overlap size and determinism, BM25 against hand-computed scores to twelve decimal places and against parameter sensitivity, both validators against every fixture with assertions on *which* rule each error names, Marp markdown structure down to per-slide bullet counts against a deliberately non-uniform fixture (2/3/1/4 key points), HTML document shape and escaping, and the skill catalog including that each skill body contains the literal tool names it must call.

Two of those deserve highlighting because they are where weak tests usually hide:

- BM25 asserts *values*, not "something non-zero came back". A test that only checks for a positive number passes against a formula with the wrong IDF, the wrong saturation, or no length normalisation at all.
- Validator tests assert the error *names the violated field and rule*, not just `valid === false`. A validator that always returns "invalid" would pass the weak version of that test, and it would be useless to the retry loop that consumes the errors.

**Not tested, deliberately.**

- **Model output quality.** Nothing here generates outline or script content — the LLM does that at runtime from the Markdown instructions. Testing whether a generated outline is *good* needs live API calls and eval-style scoring against reference decks. Out of scope. The suite guarantees a malformed outline is always caught; it says nothing about whether a well-formed one is any good.
- **The live MCP call.** `search_reference`'s `ctx.tools.execute()` path has no test. Mocking the tool registry would assert only that this code calls the API the way this code calls it, which is not evidence of anything. Meaningful coverage needs a running harness with a configured MCP server — an integration test, not a unit test.
- **Visual rendering.** Marp's own output is Marp's to test. `render-html.spec.ts` checks document structure, CSS inlining, content carry-through, and escaping, not pixels.

## 9. Deviations forced by the real API

Recorded because "the spec said X, the code does Y" is exactly what a reviewer should ask about.

**Skill names are kebab-case, not snake_case.** The design called for `outline_skill`, `script_skill`, `render_skill`. `@deepseek-ai/dsh-skill` validates every candidate name against `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` and **throws** on a mismatch, so underscored names would have made the plugin fail at registration. Skills are `outline-skill`, `script-skill`, `render-skill`, with content filenames matched to them so the `./content/${name}.md` locator stays literal. `skill-provider.spec.ts` asserts the grammar directly, so the constraint cannot be forgotten.

**Tool names keep snake_case.** Tool names have no such grammar — dsh's own tools are `run_code`, and bridged MCP tools are `read_text_file` — so `search_reference`, `validate_outline`, `validate_script`, and `render_slides` are unchanged.

**Source imports use `.ts` extensions.** `tsconfig.json` enables `allowImportingTsExtensions` with `rewriteRelativeImportExtensions`, which rewrites them to `.js` on emit. This matches dsh's own convention — its shipped `.d.ts` files import `./index.ts` — so the two codebases read the same way.

**No `as any` anywhere.** The plan allowed one pragmatic cast at a type-system boundary if the public types did not expose something. None was needed: `ToolCallId` is a value export of `@deepseek-ai/dsh-llm`, and `ToolRunContext`, `ToolExecutionInput`, and `SkillProvider` are all public. The one place that did need care was a helper type derived via `Parameters<typeof defineTool>`, which sent TypeScript into excessive-depth recursion through the DSL's inference machinery; importing the exported `ToolRunContext` directly fixed it. The whole codebase typechecks under `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

## 10. Open items for live integration

Not yet verified against a running harness, and the first things to check:

1. **`cordis.yml` top-level shape.** The plugin *entries* in `cordis.example.yml` follow the published shapes for mcp-client and this plugin. The key that wraps the plugin list is assumed to be `plugins:`. Confirm against the dsh version's own generated config — or sidestep it entirely with `cordis.patch.example.yml`, whose `- insert:` overlay form does not depend on the surrounding structure.

2. **MCP filesystem response shape.** `search_reference` treats `result.content` as content blocks, keeps the `type: 'text'` ones, and joins their `text`. That follows dsh's `ToolExecutionResult` type. What is unconfirmed is how the mcp-client bridge represents a file read — one text block or several, and whether it prefixes anything. If a read comes back with a header line or split across blocks, `readReferenceFile` is the one place to adjust.

3. **Whether `parent: exec.token` behaves as documented** for a nested dispatch from a native tool into a bridged MCP tool. The type documentation is explicit that a parentless call is rejected under PTC mode; that this is the *right* token to pass is inferred from the docs, not observed.

4. **Skill discovery.** That `ctx.skills.registerProvider` inside `apply()` surfaces all three skills in the agent's catalog, that `rank: 700` does not collide with anything, and that a user-invocable skill shows up as expected on the human-facing command surface.

5. **End-to-end pipeline behaviour** — the part no unit test can reach: whether the model actually stops at the confirmation gates, and whether it routes revisions per §6's rule. If it does not stop reliably, the fix is in the skill prose, and that is a legitimate finding rather than a code bug.

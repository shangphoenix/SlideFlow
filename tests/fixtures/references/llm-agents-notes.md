# LLM Agents Notes

An agent loop is small: send the conversation to the model, receive either text or a tool call, execute the tool, append the result, and repeat until the model stops asking for tools. Almost everything that distinguishes agent frameworks is what surrounds that loop rather than the loop itself, which is why a from-scratch implementation is usually under two hundred lines.

Tool definitions are the interface between the model and the outside world. Each tool advertises a name, a description, and a JSON Schema for its arguments. The description is prompt text and should be written as instructions to the model, not as API documentation for a human. Schema constraints are enforced before the handler runs, so a tool that validates its own arguments a second time is guarding against handler bugs rather than model mistakes.

Structured output is the other half of the same problem. Asking a model for JSON and hoping produces malformed output often enough to matter at scale. Validating against a schema and feeding the validation errors back for a bounded number of retries converts an unreliable generator into a reliable one, provided the retry budget is finite and the failure is surfaced honestly rather than papered over.

Retrieval grounds a model in material it was not trained on. Keyword ranking such as BM25 needs no embedding model, no vector store, and no index build step, which makes it a reasonable default for corpora of tens or hundreds of documents. Dense retrieval earns its infrastructure when the corpus is large or when queries and documents share meaning without sharing vocabulary.

Human confirmation gates are the cheapest safety mechanism available to an agent pipeline. Presenting a plan in readable prose and waiting for a natural-language reply costs one round trip and catches the class of error where the model has confidently understood the wrong task.
